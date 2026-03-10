import {
    OnlinePumpSdk,
    PUMP_SDK,
    getBuyTokenAmountFromSolAmount,
    getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
    calculatePriceInLamports,
    calculatePumpTokenLamportsValue,
} from '@src/blockchains/solana/dex/pumpfun/pump-base';
import {
    computeBondingCurveMetrics,
    computePriceInSol,
    fromSdkBondingCurve,
    getTokenBondingCurveState,
} from '@src/blockchains/solana/dex/pumpfun/pump-bonding-curve';
import { getPumpCoinDataWithRetriesFromFrontendApi } from '@src/blockchains/solana/dex/pumpfun/pump-fe-api';
import {
    simulatePumpAccountCreationFeeLamports,
    simulatePumpBuyLatencyMs,
    simulatePumpSellLatencyMs,
} from '@src/blockchains/solana/dex/pumpfun/pump-simulation';
import PumpfunListener from '@src/blockchains/solana/dex/pumpfun/PumpfunListener';
import { RetryConfig } from '@src/core/types';
import { logger } from '@src/logger';
import { getJitoTipLamports } from '@src/trading/bots/blockchains/solana/PumpfunBacktester';
import { TransactionType } from '@src/trading/bots/types';
import { sleep } from '@src/utils/functions';

import {
    NewPumpFunTokenData,
    PumpFunCoinData,
    PumpfunBuyResponse,
    PumpfunListenerInterface,
    PumpfunSellResponse,
    PumpfunTokenBcStats,
} from './types';
import { lamportsToSol, solToLamports } from '../../../utils/amount';
import { JitoConfig } from '../../Jito';
import { TransactionMode, WalletInfo } from '../../types';
import { extractBuyResultsFromTx, extractPossibleErrorFromTx, extractSellResultsFromTx } from './utils/tx-parser';
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, getKeyPairFromPrivateKey, sendTx } from '../../utils/helpers';
import {
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulateSolTransactionDetails,
} from '../../utils/simulations';
import { getSolTransactionDetails } from '../../utils/transactions';

type SwapBaseParams = {
    transactionMode: TransactionMode;
    wallet: WalletInfo;
    tokenMint: string;
    tokenProgramId: string;
    tokenBondingCurve: string;
    tokenAssociatedBondingCurve: string;
    priorityFeeInSol?: number;
    slippageDecimal?: number;
    jitoConfig?: JitoConfig;
};

/**
 * @see https://github.com/nirholas/pump-fun-sdk
 * @see https://github.dev/bilix-software/solana-pump-fun
 * If the transactions fail with weird error 'Program Error: "Instruction #4 Failed - Program failed to complete"' like this one
 * https://solscan.io/tx/3jkrwjvPYGcmkqRZYDST7suaqYdtr5qJC9rXKWhSo6pq3SA6zCJ2QRQP5T6FDNiZXh9dnFYADpCuCB4JKvouKaLC
 * you might need to first sign in with the wallet in pump.fun manually to accept the "terms". After can use the code
 *
 * If confirmation of transactions fails, might need to increase priority fee
 */
export default class Pumpfun implements PumpfunListenerInterface {
    private static readonly defaultPriorityInSol = 0;
    private static readonly defaultSlippageDecimal = 0.25;

    readonly connection: Connection;
    readonly listener: PumpfunListenerInterface;
    readonly sdk: OnlinePumpSdk;

    private static readonly getTxDetailsRetryConfig: RetryConfig = {
        maxRetries: 10,
        sleepMs: 250,
    };

    constructor(private readonly config: { rpcEndpoint: string; wsEndpoint: string }) {
        this.connection = new Connection(this.config.rpcEndpoint, 'confirmed');
        this.listener = new PumpfunListener(this.config, this.connection);
        this.sdk = new OnlinePumpSdk(this.connection);
    }

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => Promise<void>): Promise<void> {
        return this.listener.listenForPumpFunTokens(onNewToken);
    }

    async stopListeningToNewTokens(): Promise<void> {
        return this.listener.stopListeningToNewTokens();
    }

    async buy(
        p: {
            solIn: number;
        } & SwapBaseParams,
    ): Promise<PumpfunBuyResponse> {
        const { mint, user, tokenProgramId, slippageDecimal, priorityFeeInSol, payer } = await this.parseArgsCommon(
            p,
            'buy',
        );

        const [buyState, global, feeConfig] = await Promise.all([
            this.sdk.fetchBuyState(mint, user, tokenProgramId),
            this.sdk.fetchGlobal(),
            this.sdk.fetchFeeConfig(),
        ]);
        const lamportsAmount = new BN(solToLamports(p.solIn));
        const expectedTokens = getBuyTokenAmountFromSolAmount({
            global,
            feeConfig,
            mintSupply: buyState.bondingCurve.tokenTotalSupply,
            bondingCurve: buyState.bondingCurve,
            amount: lamportsAmount,
        });
        const buyIxs = await PUMP_SDK.buyInstructions({
            global,
            ...buyState,
            mint: mint,
            user: user,
            amount: expectedTokens,
            solAmount: new BN(solToLamports(p.solIn)),
            slippage: slippageDecimal,
            tokenProgram: tokenProgramId,
        });

        const txBuilder = new Transaction().add(...buyIxs);

        const tokenOutNum = expectedTokens.toNumber();
        const solInWithSlippage = p.solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solToLamports(solInWithSlippage));

        if (p.transactionMode === TransactionMode.Execution) {
            const buyResult = await sendTx(
                this.connection,
                txBuilder,
                payer.publicKey,
                [payer],
                {
                    unitLimit: 1400000,
                    unitPrice: solToLamports(priorityFeeInSol),
                },
                DEFAULT_COMMITMENT,
                DEFAULT_FINALITY,
                p.jitoConfig?.jitoEnabled,
                p.jitoConfig?.tipLamports,
                p.jitoConfig?.endpoint,
            );

            if (buyResult.error) {
                throw buyResult.error;
            }
            const { signature } = buyResult;

            logger.info(`Buy transaction confirmed: https://solscan.io/tx/${signature}`);

            const fullTxDetails = await getSolTransactionDetails(
                this.connection,
                signature!,
                payer.publicKey.toBase58(),
                Pumpfun.getTxDetailsRetryConfig,
            );
            const txDetails = extractPossibleErrorFromTx(fullTxDetails);
            if (txDetails.error) {
                throw txDetails;
            }

            const tradeResultFromTx = extractBuyResultsFromTx(
                fullTxDetails.fullTransaction,
                p.wallet.address,
                p.tokenMint,
                p.tokenBondingCurve,
            );
            if (tradeResultFromTx.amountRaw !== tokenOutNum) {
                throw new Error(
                    `${tradeResultFromTx.amountRaw}(actualDetails.amountRaw) is different than ${tokenOutNum}(tokenOut)`,
                );
            }

            const actualBuyPriceInSol = lamportsToSol(tradeResultFromTx.priceLamports);

            return {
                signature: signature!,
                boughtAmountRaw: tokenOutNum,
                pumpTokenOut: tokenOutNum,
                pumpMaxSolCost: maxSolCost,
                actualBuyPriceSol: actualBuyPriceInSol,
                txDetails: txDetails,
                metadata: {
                    startActionBondingCurveState: fromSdkBondingCurve(p.tokenBondingCurve, buyState.bondingCurve),
                    price: {
                        calculationMode: 'bondingCurveTransferred',
                        fromBondingCurveTransferredInSol: actualBuyPriceInSol,
                        fromTxGrossTransferredInSol: lamportsToSol(
                            calculatePriceInLamports({
                                amountRaw: tokenOutNum,
                                lamports: txDetails.grossTransferredLamports,
                            }),
                        ),
                    },
                },
            };
        } else {
            // running the simulation incur fees so skipping for now
            // const simulatedResult = await this.connection.simulateTransaction(transaction);
            // logger.info(simulatedResult);

            await sleep(
                simulatePumpBuyLatencyMs(
                    priorityFeeInSol,
                    p.jitoConfig ?? {
                        jitoEnabled: false,
                    },
                    true,
                ),
            );

            const simActualBuyPriceLamports = Math.min(
                simulatePriceWithHigherSlippage(solToLamports(p.solIn), slippageDecimal),
                solToLamports(maxSolCost),
            );
            let willCreateTokenAccount = true; // after 1st time this is should be false for sim, but atm we trade only 1 time per token so it is ok

            return {
                signature: _generateFakeSimulationTransactionHash(),
                boughtAmountRaw: tokenOutNum,
                pumpTokenOut: tokenOutNum,
                pumpMaxSolCost: maxSolCost,
                actualBuyPriceSol: lamportsToSol(simActualBuyPriceLamports),
                txDetails: simulateSolTransactionDetails(
                    -simActualBuyPriceLamports -
                        getJitoTipLamports(p.jitoConfig) -
                        (willCreateTokenAccount ? simulatePumpAccountCreationFeeLamports() : 0),
                    solToLamports(priorityFeeInSol),
                ),
                metadata: {
                    startActionBondingCurveState: fromSdkBondingCurve(p.tokenBondingCurve, buyState.bondingCurve),
                    price: {
                        calculationMode: 'simulation',
                    },
                },
            };
        }
    }

    async sell(
        p: {
            tokenBalance: number;
        } & SwapBaseParams,
    ): Promise<PumpfunSellResponse> {
        const { mint, user, tokenProgramId, slippageDecimal, priorityFeeInSol, payer } = await this.parseArgsCommon(
            p,
            'sell',
        );

        const [sellState, global, feeConfig] = await Promise.all([
            this.sdk.fetchSellState(mint, user, tokenProgramId),
            this.sdk.fetchGlobal(),
            this.sdk.fetchFeeConfig(),
        ]);

        const tokenAmount = new BN(p.tokenBalance); // amount in raw units (6 decimals)
        const expectedSol = getSellSolAmountFromTokenAmount({
            global,
            feeConfig,
            mintSupply: sellState.bondingCurve.tokenTotalSupply,
            bondingCurve: sellState.bondingCurve,
            amount: tokenAmount,
        });
        const minLamportsOutput = expectedSol.toNumber();

        const sellIxs = await PUMP_SDK.sellInstructions({
            global,
            ...sellState,
            mint: mint,
            user: user,
            amount: tokenAmount,
            solAmount: expectedSol,
            slippage: slippageDecimal,
            mayhemMode: sellState.bondingCurve.isMayhemMode,
            tokenProgram: tokenProgramId,
        });

        const txBuilder = new Transaction().add(...sellIxs);

        if (p.transactionMode === TransactionMode.Execution) {
            const sellResult = await sendTx(
                this.connection,
                txBuilder,
                payer.publicKey,
                [payer],
                {
                    unitLimit: 1400000,
                    unitPrice: solToLamports(priorityFeeInSol),
                },
                DEFAULT_COMMITMENT,
                DEFAULT_FINALITY,
                p.jitoConfig?.jitoEnabled,
                p.jitoConfig?.tipLamports,
                p.jitoConfig?.endpoint,
            );

            if (sellResult.error) {
                throw sellResult.error;
            }
            const { signature } = sellResult;

            logger.info(`Sell transaction confirmed: https://solscan.io/tx/${signature}`);

            const fullTxDetails = await getSolTransactionDetails(
                this.connection,
                signature!,
                payer.publicKey.toBase58(),
                Pumpfun.getTxDetailsRetryConfig,
            );
            const txDetails = extractPossibleErrorFromTx(fullTxDetails);
            if (txDetails.error) {
                throw txDetails;
            }

            const tradeResultFromTx = extractSellResultsFromTx(
                fullTxDetails.fullTransaction,
                p.wallet.address,
                p.tokenMint,
                p.tokenBondingCurve,
            );
            if (tradeResultFromTx.amountRaw !== p.tokenBalance) {
                throw new Error(
                    `${tradeResultFromTx.amountRaw}(actualDetails.amountRaw) is different than ${p.tokenBalance}(tokenOut)`,
                );
            }

            const actualSellPriceInSol = lamportsToSol(tradeResultFromTx.priceLamports);

            return {
                signature: signature!,
                soldRawAmount: p.tokenBalance,
                minLamportsOutput: minLamportsOutput,
                actualSellPriceSol: actualSellPriceInSol,
                txDetails: txDetails,
                metadata: {
                    startActionBondingCurveState: fromSdkBondingCurve(p.tokenBondingCurve, sellState.bondingCurve),
                    price: {
                        calculationMode: 'bondingCurveTransferred',
                        fromBondingCurveTransferredInSol: actualSellPriceInSol,
                        fromTxGrossTransferredInSol: lamportsToSol(
                            calculatePriceInLamports({
                                amountRaw: p.tokenBalance,
                                lamports: txDetails.grossTransferredLamports,
                            }),
                        ),
                    },
                },
            };
        } else {
            // running the simulation incur fees so skipping for now
            // const simulatedResult = await this.connection.simulateTransaction(transaction);
            // logger.info(simulatedResult);

            await sleep(
                simulatePumpSellLatencyMs(
                    priorityFeeInSol,
                    p.jitoConfig ?? {
                        jitoEnabled: false,
                    },
                    true,
                ),
            );

            const simActualSellPriceLamports = Math.max(
                minLamportsOutput,
                simulatePriceWithLowerSlippage(
                    calculatePumpTokenLamportsValue(p.tokenBalance, computePriceInSol(sellState.bondingCurve)),
                    slippageDecimal,
                ),
            );

            return {
                signature: _generateFakeSimulationTransactionHash(),
                soldRawAmount: p.tokenBalance,
                minLamportsOutput: minLamportsOutput,
                actualSellPriceSol: lamportsToSol(simActualSellPriceLamports),
                txDetails: simulateSolTransactionDetails(
                    simActualSellPriceLamports - getJitoTipLamports(p.jitoConfig),
                    solToLamports(priorityFeeInSol),
                ),
                metadata: {
                    startActionBondingCurveState: fromSdkBondingCurve(p.tokenBondingCurve, sellState.bondingCurve),
                    price: {
                        calculationMode: 'simulation',
                    },
                },
            };
        }
    }

    async parseArgsCommon(p: SwapBaseParams, _transactionType: TransactionType) {
        return {
            tokenProgramId: p.tokenProgramId ? new PublicKey(p.tokenProgramId) : TOKEN_2022_PROGRAM_ID,
            mint: new PublicKey(p.tokenMint),
            user: new PublicKey(p.wallet.address),
            payer: getKeyPairFromPrivateKey(p.wallet.privateKey),
            priorityFeeInSol: p.priorityFeeInSol ?? Pumpfun.defaultPriorityInSol,
            slippageDecimal: p.slippageDecimal ?? Pumpfun.defaultSlippageDecimal,
        };
    }

    async getCoinDataWithRetries(
        tokenMint: string,
        retryConfig: RetryConfig = { maxRetries: 3, sleepMs: 0 },
    ): Promise<PumpFunCoinData> {
        return getPumpCoinDataWithRetriesFromFrontendApi(logger, tokenMint, retryConfig);
    }

    async getTokenBondingCurveStats(tokenBondingCurve: string): Promise<PumpfunTokenBcStats> {
        const { state: bcState } = await getTokenBondingCurveState(this.connection, {
            bondingCurve: new PublicKey(tokenBondingCurve),
        });
        const bcMetrics = computeBondingCurveMetrics(bcState);

        return {
            marketCapInSol: bcMetrics.marketCapInSol,
            priceInSol: bcMetrics.priceInSol,
            bondingCurveProgress: bcMetrics.bondingCurveProgress,
            virtualSolReserves: bcState.virtualSolReserves,
            virtualTokenReserves: bcState.virtualTokenReserves,
        };
    }
}

function _generateFakeSimulationTransactionHash() {
    return `_simulation_${Date.now()}`;
}
