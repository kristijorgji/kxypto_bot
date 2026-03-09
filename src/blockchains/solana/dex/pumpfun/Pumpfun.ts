import { BONDING_CURVE_NEW_SIZE, PUMP_SDK, userVolumeAccumulatorPda } from '@pump-fun/pump-sdk';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import { AccountMeta, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

import {
    calculatePriceInLamports,
    calculatePumpTokenLamportsValue,
} from '@src/blockchains/solana/dex/pumpfun/pump-base';
import {
    computeBondingCurveMetrics,
    getTokenBondingCurveState,
} from '@src/blockchains/solana/dex/pumpfun/pump-bonding-curve';
import { getPumpCoinDataWithRetriesFromFrontendApi } from '@src/blockchains/solana/dex/pumpfun/pump-fe-api';
import { getCreatorVaultAddress } from '@src/blockchains/solana/dex/pumpfun/pump-pda';
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
import { bufferFromUInt64 } from '@src/utils/data/data';
import { sleep } from '@src/utils/functions';

import {
    PUMP_BUY_BUFFER,
    PUMP_FEE_CONFIG,
    PUMP_FEE_PROGRAM,
    PUMP_FEE_RECIPIENT_6,
    PUMP_FUN_ACCOUNT,
    PUMP_FUN_PROGRAM,
    PUMP_GLOBAL,
    PUMP_GLOBAL_VOLUME_ACCUMULATOR,
    PUMP_SELL_BUFFER,
    SYSTEM_PROGRAM_ID,
} from './constants';
import {
    BondingCurveFullState,
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

    private static readonly getTxDetailsRetryConfig: RetryConfig = {
        maxRetries: 10,
        sleepMs: 250,
    };

    constructor(private readonly config: { rpcEndpoint: string; wsEndpoint: string }) {
        this.connection = new Connection(this.config.rpcEndpoint, 'confirmed');
        this.listener = new PumpfunListener(this.config, this.connection);
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
        const tokenProgram = p.tokenProgramId ? new PublicKey(p.tokenProgramId) : TOKEN_2022_PROGRAM_ID;
        const priorityFeeInSol = p.priorityFeeInSol ?? Pumpfun.defaultPriorityInSol;
        const slippageDecimal = p.slippageDecimal ?? Pumpfun.defaultSlippageDecimal;

        const bcFullState = await getTokenBondingCurveState(this.connection, {
            bondingCurve: new PublicKey(p.tokenBondingCurve),
        });
        const { state: bcs } = bcFullState;
        const { payer, txBuilder, keys, willCreateTokenAccount } = await this.buildTxCommon(
            p,
            'buy',
            tokenProgram,
            bcFullState,
        );

        const solInLamports = solToLamports(p.solIn);
        const tokenOut = Math.floor((solInLamports * bcs.virtualTokenReserves) / bcs.virtualSolReserves);
        const solInWithSlippage = p.solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solToLamports(solInWithSlippage));
        const trackVolume = Buffer.from([1]); // 1 to enable volume tracking/cashback, 0 to disable
        const data: Buffer = Buffer.concat([
            PUMP_BUY_BUFFER,
            bufferFromUInt64(tokenOut),
            bufferFromUInt64(maxSolCost),
            trackVolume,
        ]);

        const instruction = new TransactionInstruction({
            keys: keys,
            programId: PUMP_FUN_PROGRAM,
            data: data,
        });
        txBuilder.add(instruction);

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
            if (tradeResultFromTx.amountRaw !== tokenOut) {
                throw new Error(
                    `${tradeResultFromTx.amountRaw}(actualDetails.amountRaw) is different than ${tokenOut}(tokenOut)`,
                );
            }

            const actualBuyPriceInSol = lamportsToSol(tradeResultFromTx.priceLamports);

            return {
                signature: signature!,
                boughtAmountRaw: tokenOut,
                pumpTokenOut: tokenOut,
                pumpMaxSolCost: maxSolCost,
                actualBuyPriceSol: actualBuyPriceInSol,
                txDetails: txDetails,
                metadata: {
                    startActionBondingCurveState: bcs,
                    price: {
                        calculationMode: 'bondingCurveTransferred',
                        fromBondingCurveTransferredInSol: actualBuyPriceInSol,
                        fromTxGrossTransferredInSol: lamportsToSol(
                            calculatePriceInLamports({
                                amountRaw: tokenOut,
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
                simulatePriceWithHigherSlippage(solInLamports, slippageDecimal),
                solToLamports(maxSolCost),
            );

            return {
                signature: _generateFakeSimulationTransactionHash(),
                boughtAmountRaw: tokenOut,
                pumpTokenOut: tokenOut,
                pumpMaxSolCost: maxSolCost,
                actualBuyPriceSol: lamportsToSol(simActualBuyPriceLamports),
                txDetails: simulateSolTransactionDetails(
                    -simActualBuyPriceLamports -
                        getJitoTipLamports(p.jitoConfig) -
                        (willCreateTokenAccount ? simulatePumpAccountCreationFeeLamports() : 0),
                    solToLamports(priorityFeeInSol),
                ),
                metadata: {
                    startActionBondingCurveState: bcs,
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
        const tokenProgram = p.tokenProgramId ? new PublicKey(p.tokenProgramId) : TOKEN_2022_PROGRAM_ID;
        const priorityFeeInSol = p.priorityFeeInSol ?? Pumpfun.defaultPriorityInSol;
        const slippageDecimal = p.slippageDecimal ?? Pumpfun.defaultSlippageDecimal;

        const bcFullState = await getTokenBondingCurveState(this.connection, {
            bondingCurve: new PublicKey(p.tokenBondingCurve),
        });
        const { state: bcs } = bcFullState;
        const { priceInSol } = computeBondingCurveMetrics(bcs);
        const { payer, txBuilder, keys } = await this.buildTxCommon(p, 'sell', tokenProgram, bcFullState);

        const minLamportsOutput = Math.floor(
            (p.tokenBalance! * (1 - slippageDecimal) * bcs.virtualSolReserves) / bcs.virtualTokenReserves,
        );
        const data = Buffer.concat([
            PUMP_SELL_BUFFER,
            bufferFromUInt64(p.tokenBalance),
            bufferFromUInt64(minLamportsOutput),
        ]);

        const instruction = new TransactionInstruction({
            keys: keys,
            programId: PUMP_FUN_PROGRAM,
            data: data,
        });
        txBuilder.add(instruction);

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
                    startActionBondingCurveState: bcs,
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
                    calculatePumpTokenLamportsValue(p.tokenBalance, priceInSol),
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
                    startActionBondingCurveState: bcs,
                    price: {
                        calculationMode: 'simulation',
                    },
                },
            };
        }
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

    async buildTxCommon(
        p: SwapBaseParams,
        transactionType: TransactionType,
        tokenProgram: PublicKey,
        bondingCurveFullState: BondingCurveFullState,
    ): Promise<{
        payer: Keypair;
        txBuilder: Transaction;
        keys: Array<AccountMeta>;
        willCreateTokenAccount: boolean;
    }> {
        let willCreateTokenAccount = false;
        const payer = getKeyPairFromPrivateKey(p.wallet.privateKey);
        const mintKey = new PublicKey(p.tokenMint);
        const txBuilder = new Transaction();

        if (bondingCurveFullState.accountInfo.data.length < BONDING_CURVE_NEW_SIZE) {
            txBuilder.instructions.push(
                await PUMP_SDK.extendAccountInstruction({
                    account: new PublicKey(p.tokenBondingCurve),
                    user: payer.publicKey,
                }),
            );
        }

        const tokenAccountAddress = await getAssociatedTokenAddress(mintKey, payer.publicKey, false, tokenProgram);
        const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountIdempotentInstruction(
                    payer.publicKey,
                    tokenAccountAddress,
                    payer.publicKey,
                    mintKey,
                    tokenProgram,
                    ASSOCIATED_TOKEN_PROGRAM_ID,
                ),
            );
            tokenAccount = tokenAccountAddress;
            willCreateTokenAccount = true;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const creatorFeeVault = getCreatorVaultAddress(bondingCurveFullState.state.dev);
        const userVolumeAccumulator = userVolumeAccumulatorPda(payer.publicKey);

        const keys: AccountMeta[] = [
            { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: PUMP_FEE_RECIPIENT_6, isSigner: false, isWritable: true },
            { pubkey: mintKey, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(p.tokenBondingCurve), isSigner: false, isWritable: true },
            { pubkey: new PublicKey(p.tokenAssociatedBondingCurve), isSigner: false, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

        if (transactionType === 'buy') {
            keys.push(
                { pubkey: tokenProgram, isSigner: false, isWritable: false },
                { pubkey: creatorFeeVault, isSigner: false, isWritable: true },
                { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false }, // Event Authority
                { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
                { pubkey: PUMP_GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: false },
                { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
                { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
                { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
            );
        } else {
            // Sell instruction
            keys.push(
                { pubkey: creatorFeeVault, isSigner: false, isWritable: true },
                { pubkey: tokenProgram, isSigner: false, isWritable: false },
                { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false }, // Event Authority
                { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
                { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
                { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
                { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
            );
        }

        return {
            payer: payer,
            txBuilder: txBuilder,
            keys: keys,
            willCreateTokenAccount: willCreateTokenAccount,
        };
    }
}

function _generateFakeSimulationTransactionHash() {
    return `_simulation_${Date.now()}`;
}
