import { clearTimeout } from 'node:timers';

import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { RpcAccount } from '@metaplex-foundation/umi';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { AccountMeta, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import axios, { AxiosError } from 'axios';
import bs58 from 'bs58';
import WebSocket, { MessageEvent } from 'ws';

import {
    calculatePriceInLamports,
    calculatePumpTokenLamportsValue,
    computeBondingCurveMetrics,
    extractBuyResultsFromTx,
    extractPossibleErrorFromTx,
    extractSellResultsFromTx,
    getAssociatedBondingCurveAddress,
    getCreatorVaultAddress,
    getTokenBondingCurveState,
} from '@src/blockchains/solana/dex/pumpfun/pump-base';
import {
    simulatePumpAccountCreationFeeLamports,
    simulatePumpBuyLatencyMs,
    simulatePumpSellLatencyMs,
} from '@src/blockchains/solana/dex/pumpfun/pump-simulation';
import { RetryConfig } from '@src/core/types';
import { logger } from '@src/logger';
import { getJitoTipLamports } from '@src/trading/bots/blockchains/solana/PumpfunBacktester';
import { TransactionType } from '@src/trading/bots/types';
import { bufferFromUInt64, randomInt } from '@src/utils/data/data';
import { sleep } from '@src/utils/functions';

import {
    PUMP_BUY_BUFFER,
    PUMP_FEE_RECIPIENT,
    PUMP_FUN_ACCOUNT,
    PUMP_FUN_PROGRAM,
    PUMP_GLOBAL,
    PUMP_GLOBAL_VOLUME_ACCUMULATOR,
    PUMP_SELL_BUFFER,
    PUMP_USER_VOLUME_ACCUMULATOR,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from './constants';
import {
    NewPumpFunTokenData,
    PumpFunCoinData,
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunListener,
    PumpfunSellResponse,
    PumpfunTokenBcStats,
} from './types';
import { lamportsToSol, solToLamports } from '../../../utils/amount';
import { JitoConfig } from '../../Jito';
import { getMetadataPDA } from '../../SolanaAdapter';
import { TransactionMode, WalletInfo, WssMessage } from '../../types';
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, getKeyPairFromPrivateKey, sendTx } from '../../utils/helpers';
import {
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulateSolTransactionDetails,
} from '../../utils/simulations';
import { getTokenIfpsMetadata } from '../../utils/tokens';
import { getSolTransactionDetails } from '../../utils/transactions';

type SwapBaseParams = {
    transactionMode: TransactionMode;
    wallet: WalletInfo;
    tokenMint: string;
    tokenBondingCurve: string;
    tokenAssociatedBondingCurve: string;
    priorityFeeInSol?: number;
    slippageDecimal?: number;
    jitoConfig?: JitoConfig;
};

/**
 * @see https://github.dev/bilix-software/solana-pump-fun
 * If the transactions fail with weird error 'Program Error: "Instruction #4 Failed - Program failed to complete"' like this one
 * https://solscan.io/tx/3jkrwjvPYGcmkqRZYDST7suaqYdtr5qJC9rXKWhSo6pq3SA6zCJ2QRQP5T6FDNiZXh9dnFYADpCuCB4JKvouKaLC
 * you might need to first sign in with the wallet in pump.fun manually to accept the "terms". After can use the code
 *
 * If confirmation of transactions fails, might need to increase priority fee
 */
export default class Pumpfun implements PumpfunListener {
    private static readonly defaultPriorityInSol = 0;
    private static readonly defaultSlippageDecimal = 0.25;

    readonly connection: Connection;

    private listeningToNewTokens = false;
    private ws: WebSocket | undefined;
    private relistenTimeout: ReturnType<typeof setTimeout> | undefined;

    private static readonly getTxDetailsRetryConfig: RetryConfig = {
        maxRetries: 10,
        sleepMs: 250,
    };

    constructor(private readonly config: { rpcEndpoint: string; wsEndpoint: string }) {
        this.connection = new Connection(this.config.rpcEndpoint, 'confirmed');
    }

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void): Promise<void> {
        this.listeningToNewTokens = true;

        try {
            this.ws = new WebSocket(this.config.wsEndpoint);

            this.ws!.on('open', () => {
                const subscriptionMessage = JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'logsSubscribe',
                    params: [{ mentions: [PUMP_FUN_PROGRAM] }, { commitment: 'processed' }],
                });
                this.ws!.send(subscriptionMessage);
                logger.info(`Listening for new token creations from program: ${PUMP_FUN_PROGRAM}`);
            });

            this.ws!.on('message', message => {
                const data = (message as unknown as MessageEvent).type
                    ? JSON.parse(<string>(message as unknown as MessageEvent).data)
                    : (JSON.parse(message.toString()) as WssMessage);

                if (data.method !== 'logsNotification') {
                    return;
                }

                const logData = data.params.result.value;
                const logs = logData.logs || [];

                if (logs.some((log: string) => log.includes('Program log: Instruction: Create'))) {
                    for (const log of logs) {
                        if (log.startsWith('Program data:')) {
                            try {
                                const encodedData = log.split(': ')[1];
                                const decodedData = Buffer.from(encodedData, 'base64');
                                const parsedData = parseCreateInstruction(decodedData);

                                if (parsedData && parsedData.name) {
                                    onNewToken(parsedData);
                                }
                            } catch (error) {
                                logger.error(`Failed to decode: ${log}`);
                                logger.error(`Error: ${error}`);
                            }
                        }
                    }
                }
            });

            this.ws!.on('error', error => {
                logger.error(`WebSocket error: ${error}`);
            });

            this.ws!.on('close', async (code, reason) => {
                if (this.listeningToNewTokens) {
                    logger.debug(`Connection closed, code ${code}, reason ${reason}. Reconnecting in 5 seconds...`);
                    this.relistenTimeout = setTimeout(() => {
                        this.listenForPumpFunTokens(onNewToken);
                    }, 5000);
                } else {
                    logger.info('Will not retry connecting because we set listeningToNewTokens=false');
                }
            });
        } catch (error) {
            logger.error(`Connection error: ${error}`);

            if (this.listeningToNewTokens) {
                logger.debug('Reconnecting in 5 seconds...');
                this.relistenTimeout = setTimeout(() => {
                    this.listenForPumpFunTokens(onNewToken);
                }, 5000);
            } else {
                logger.info('Will not retry connecting because we set listeningToNewTokens=false');
            }
        }
    }

    stopListeningToNewTokens(): void {
        clearTimeout(this.relistenTimeout);
        this.listeningToNewTokens = false;
        if (this.ws) {
            this.ws?.removeAllListeners && this.ws?.removeAllListeners();
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws?.close();
            }
            this.ws = undefined;
        }
    }

    async getInitialCoinBaseData(mint: string): Promise<PumpfunInitialCoinData> {
        const mintKey = new PublicKey(mint);
        const bcState = await getTokenBondingCurveState(this.connection, { mint: mint });

        const metadataPDA = await getMetadataPDA(mintKey);
        const metaDataAccountInfo = await this.connection.getAccountInfo(metadataPDA);
        const metadata = deserializeMetadata(metaDataAccountInfo! as unknown as RpcAccount);

        const ipfsMetadata = await getTokenIfpsMetadata(metadata.uri);

        return {
            mint: mint,
            creator: bcState.dev,
            // TODO find a way to fetch createdTimestamp via Pumpfun.getInitialCoinBaseData
            createdTimestamp: Date.now(),
            bondingCurve: bcState.bondingCurve,
            associatedBondingCurve: getAssociatedBondingCurveAddress(
                new PublicKey(bcState.bondingCurve),
                mintKey,
            ).toBase58(),
            name: ipfsMetadata.name,
            symbol: ipfsMetadata.symbol,
            description: ipfsMetadata.description,
            image: ipfsMetadata.image,
            twitter: ipfsMetadata.twitter,
            telegram: ipfsMetadata.telegram,
            website: ipfsMetadata.website,
        };
    }

    async buy(
        p: {
            solIn: number;
        } & SwapBaseParams,
    ): Promise<PumpfunBuyResponse> {
        const priorityFeeInSol = p.priorityFeeInSol ?? Pumpfun.defaultPriorityInSol;
        const slippageDecimal = p.slippageDecimal ?? Pumpfun.defaultSlippageDecimal;

        const bcs = await getTokenBondingCurveState(this.connection, {
            bondingCurve: new PublicKey(p.tokenBondingCurve),
        });
        const { payer, txBuilder, keys, willCreateTokenAccount } = await this.buildTxCommon(p, 'buy', bcs.dev);

        const solInLamports = solToLamports(p.solIn);
        const tokenOut = Math.floor((solInLamports * bcs.virtualTokenReserves) / bcs.virtualSolReserves);
        const solInWithSlippage = p.solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solToLamports(solInWithSlippage));
        const data: Buffer = Buffer.concat([PUMP_BUY_BUFFER, bufferFromUInt64(tokenOut), bufferFromUInt64(maxSolCost)]);

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
        const priorityFeeInSol = p.priorityFeeInSol ?? Pumpfun.defaultPriorityInSol;
        const slippageDecimal = p.slippageDecimal ?? Pumpfun.defaultSlippageDecimal;

        const bcs = await getTokenBondingCurveState(this.connection, {
            bondingCurve: new PublicKey(p.tokenBondingCurve),
        });
        const { priceInSol } = computeBondingCurveMetrics(bcs);
        const { payer, txBuilder, keys } = await this.buildTxCommon(p, 'sell', bcs.dev);

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

    /**
     * A helper function to retry as needed because this frontend api is
     * buggy and fails with 500 status code often
     * Use only for the initial data and optional data, can't rely on for realtime info
     */
    async getCoinDataWithRetries(
        tokenMint: string,
        { maxRetries = 3, sleepMs = 0 }: RetryConfig,
    ): Promise<PumpFunCoinData> {
        let coinData: PumpFunCoinData | undefined;
        let retries = 0;
        let error: Error | AxiosError | undefined;

        do {
            try {
                coinData = await this.getCoinData(tokenMint);
            } catch (e) {
                error = e as Error | AxiosError;
                if (e instanceof AxiosError && e.response?.status === 429) {
                    const retryInMs = randomInt(5000, 20000);
                    logger.info(
                        'failed to fetch coin data on retry %d, we got back response 429, will retry in %ds',
                        retries,
                        retryInMs / 1000,
                    );
                    await sleep(retryInMs);
                    retries--;
                } else {
                    sleepMs = typeof sleepMs === 'function' ? sleepMs(retries + 1) : sleepMs;
                    logger.error(
                        `failed to fetch coin data on retry ${retries}, error: %s. Will retry after sleeping ${sleepMs}`,
                        (e as Error).message,
                    );
                    if (sleepMs > 0) {
                        await sleep(sleepMs);
                    }
                }
            }
        } while (!coinData && retries++ < maxRetries);

        if (!coinData) {
            throw new Error(
                `Could not fetch coinData for mint ${tokenMint} after ${retries - 1} retries, err: ${error?.message}`,
            );
        }

        return coinData;
    }

    async getTokenBondingCurveStats(tokenBondingCurve: string): Promise<PumpfunTokenBcStats> {
        const bcState = await getTokenBondingCurveState(this.connection, {
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

    async getCoinData(tokenMint: string): Promise<PumpFunCoinData> {
        const url = `https://frontend-api-v3.pump.fun/coins/${tokenMint}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
                Accept: '*/*',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                Referer: 'https://www.pump.fun/',
                Origin: 'https://www.pump.fun',
                Connection: 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site',
                'If-None-Match': 'W/"43a-tWaCcS4XujSi30IFlxDCJYxkMKg"',
            },
        });

        if (response.status === 200) {
            return response.data;
        }

        throw new Error(`Error fetching coinData ${response.status}`);
    }

    async buildTxCommon(
        p: SwapBaseParams,
        transactionType: TransactionType,
        dev: string,
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

        const tokenAccountAddress = await getAssociatedTokenAddress(mintKey, payer.publicKey, false);
        const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccountAddress, payer.publicKey, mintKey),
            );
            tokenAccount = tokenAccountAddress;
            willCreateTokenAccount = true;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const creatorFeeVault = getCreatorVaultAddress(dev);

        return {
            payer: payer,
            txBuilder: txBuilder,
            keys: [
                { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
                { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
                { pubkey: mintKey, isSigner: false, isWritable: false },
                { pubkey: new PublicKey(p.tokenBondingCurve), isSigner: false, isWritable: true },
                { pubkey: new PublicKey(p.tokenAssociatedBondingCurve), isSigner: false, isWritable: true },
                { pubkey: tokenAccount, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: false, isWritable: true },
                { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
                {
                    pubkey: transactionType === 'buy' ? TOKEN_PROGRAM_ID : creatorFeeVault,
                    isSigner: false,
                    isWritable: true,
                },
                {
                    pubkey: transactionType === 'buy' ? creatorFeeVault : TOKEN_PROGRAM_ID,
                    isSigner: false,
                    isWritable: true,
                },
                { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
                { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
                { pubkey: PUMP_GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: true },
                { pubkey: PUMP_USER_VOLUME_ACCUMULATOR, isSigner: false, isWritable: true },
            ],
            willCreateTokenAccount: willCreateTokenAccount,
        };
    }
}

function parseCreateInstruction(data: Buffer): NewPumpFunTokenData | null {
    if (data.length < 8) {
        return null;
    }

    let offset = 8;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedData: Record<string, any> = {};

    const fields: [string, 'string' | 'publicKey'][] = [
        ['name', 'string'],
        ['symbol', 'string'],
        ['uri', 'string'],
        ['mint', 'publicKey'],
        ['bondingCurve', 'publicKey'],
        ['user', 'publicKey'],
    ];

    try {
        for (const [fieldName, fieldType] of fields) {
            if (fieldType === 'string') {
                const length = data.readUInt32LE(offset);
                offset += 4;
                parsedData[fieldName] = data.subarray(offset, offset + length).toString('utf-8');
                offset += length;
            } else if (fieldType === 'publicKey') {
                parsedData[fieldName] = bs58.encode(data.subarray(offset, offset + 32));
                offset += 32;
            }
        }

        return parsedData as NewPumpFunTokenData;
    } catch {
        return null;
    }
}

function _generateFakeSimulationTransactionHash() {
    return `_simulation_${Date.now()}`;
}
