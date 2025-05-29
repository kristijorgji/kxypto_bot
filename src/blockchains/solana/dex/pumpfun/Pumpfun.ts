import { clearTimeout } from 'node:timers';

import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { RpcAccount } from '@metaplex-foundation/umi';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { AccountMeta, Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import axios, { AxiosError } from 'axios';
import BN from 'bn.js';
import bs58 from 'bs58';
import CircuitBreaker from 'opossum';
import WebSocket, { MessageEvent } from 'ws';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    FEE_RECIPIENT,
    GLOBAL,
    PUMPFUN_TOKEN_DECIMALS,
    PUMP_FUN_ACCOUNT,
    PUMP_FUN_PROGRAM,
    RENT,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from './constants';
import { pumpfunBuyLatencies, pumpfunSellLatencies } from './data/latencies';
import BondingCurveState from './domain/BondingCurveState';
import {
    NewPumpFunTokenData,
    PumpFunCoinData,
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunListener,
    PumpfunSellResponse,
    PumpfunTokenBcStats,
} from './types';
import { calculatePumpTokenLamportsValue } from './utils';
import { RetryConfig } from '../../../../core/types';
import { logger } from '../../../../logger';
import { getJitoTipLamports } from '../../../../trading/bots/blockchains/solana/PumpfunBacktester';
import { bufferFromUInt64, randomInt } from '../../../../utils/data/data';
import { sleep } from '../../../../utils/functions';
import { computeSimulatedLatencyNs } from '../../../../utils/simulations';
import { lamportsToSol, solToLamports } from '../../../utils/amount';
import { JitoConfig } from '../../Jito';
import { getMetadataPDA } from '../../SolanaAdapter';
import { TransactionMode, WssMessage } from '../../types';
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, getKeyPairFromPrivateKey, sendTx } from '../../utils/helpers';
import {
    getLatencyMetrics,
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulateSolTransactionDetails,
} from '../../utils/simulations';
import { getTokenIfpsMetadata } from '../../utils/tokens';
import { getSolTransactionDetails } from '../../utils/transactions';

type VirtualReserves = {
    virtualSolReserves: number;
    virtualTokenReserves: number;
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

    private readonly connection: Connection;

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
        const mintAddress = new PublicKey(mint);

        const bondingCurveAdddress = await this.getBondingCurveAddress(mintAddress);
        const associatedBondingCurveAddress = this.getAssociatedBondingCurveAddress(bondingCurveAdddress, mintAddress);

        const metadataPDA = await getMetadataPDA(new PublicKey(mint));
        const metaDataAccountInfo = await this.connection.getAccountInfo(metadataPDA);
        const metadata = deserializeMetadata(metaDataAccountInfo! as unknown as RpcAccount);

        const ipfsMetadata = await getTokenIfpsMetadata(metadata.uri);

        return {
            mint: mint,
            // TODO find a way to fetch these 2 below natively via Pumpfun.getInitialCoinBaseData
            creator: '_not_implemented_',
            createdTimestamp: Date.now(),
            bondingCurve: bondingCurveAdddress.toBase58(),
            associatedBondingCurve: associatedBondingCurveAddress.toBase58(),
            name: ipfsMetadata.name,
            symbol: ipfsMetadata.symbol,
            description: ipfsMetadata.description,
            image: ipfsMetadata.image,
            twitter: ipfsMetadata.twitter,
            telegram: ipfsMetadata.telegram,
            website: ipfsMetadata.website,
        };
    }

    async buy({
        transactionMode,
        payerPrivateKey,
        tokenMint,
        tokenBondingCurve,
        tokenAssociatedBondingCurve,
        solIn,
        priorityFeeInSol = Pumpfun.defaultPriorityInSol,
        slippageDecimal = Pumpfun.defaultSlippageDecimal,
        jitoConfig,
    }: {
        transactionMode: TransactionMode;
        payerPrivateKey: string;
        tokenMint: string;
        tokenBondingCurve: string;
        tokenAssociatedBondingCurve: string;
        solIn: number;
        priorityFeeInSol?: number;
        slippageDecimal?: number;
        jitoConfig?: JitoConfig;
    }): Promise<PumpfunBuyResponse> {
        const payer = await getKeyPairFromPrivateKey(payerPrivateKey);
        const mint = new PublicKey(tokenMint);

        const txBuilder = new Transaction();

        const tokenAccountAddress = await getAssociatedTokenAddress(mint, payer.publicKey, false);

        const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccountAddress, payer.publicKey, mint),
            );
            tokenAccount = tokenAccountAddress;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const { virtualTokenReserves, virtualSolReserves } = await this.getBcReserves(tokenMint, tokenBondingCurve);

        const solInLamports = solToLamports(solIn);
        const tokenOut = Math.floor((solInLamports * virtualTokenReserves) / virtualSolReserves);

        const solInWithSlippage = solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solToLamports(solInWithSlippage));
        const ASSOCIATED_USER = tokenAccount;
        const USER = payer.publicKey;
        const BONDING_CURVE = new PublicKey(tokenBondingCurve);
        const ASSOCIATED_BONDING_CURVE = new PublicKey(tokenAssociatedBondingCurve);

        const keys: Array<AccountMeta> = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: BONDING_CURVE, isSigner: false, isWritable: true },
            { pubkey: ASSOCIATED_BONDING_CURVE, isSigner: false, isWritable: true },
            { pubkey: ASSOCIATED_USER, isSigner: false, isWritable: true },
            { pubkey: USER, isSigner: false, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: RENT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        ];

        const data: Buffer = Buffer.concat([
            bufferFromUInt64('16927863322537952870'),
            bufferFromUInt64(tokenOut),
            bufferFromUInt64(maxSolCost),
        ]);

        // @ts-ignore
        const instruction = new TransactionInstruction({
            keys: keys,
            programId: PUMP_FUN_PROGRAM,
            data: data,
        });
        txBuilder.add(instruction);

        if (transactionMode === TransactionMode.Execution) {
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
                jitoConfig?.jitoEnabled,
                jitoConfig?.tipLamports,
                jitoConfig?.endpoint,
            );

            if (buyResult.error) {
                throw buyResult.error;
            }
            const { signature } = buyResult;

            logger.info(`Buy transaction confirmed: https://solscan.io/tx/${signature}`);

            return {
                signature: signature!,
                boughtAmountRaw: tokenOut,
                pumpTokenOut: tokenOut,
                pumpMaxSolCost: maxSolCost,
                txDetails: await getSolTransactionDetails(
                    this.connection,
                    signature!,
                    payer.publicKey.toBase58(),
                    Pumpfun.getTxDetailsRetryConfig,
                ),
            };
        } else {
            // running the simulation incur fees so skipping for now
            // const simulatedResult = await this.connection.simulateTransaction(transaction);
            // logger.info(simulatedResult);

            await sleep(
                simulatePumpBuyLatencyMs(
                    priorityFeeInSol,
                    jitoConfig ?? {
                        jitoEnabled: false,
                    },
                    true,
                ),
            );

            return {
                signature: _generateFakeSimulationTransactionHash(),
                boughtAmountRaw: tokenOut,
                pumpTokenOut: tokenOut,
                pumpMaxSolCost: maxSolCost,
                txDetails: simulateSolTransactionDetails(
                    -Math.min(
                        simulatePriceWithHigherSlippage(solInLamports, slippageDecimal),
                        solToLamports(maxSolCost),
                    ) - getJitoTipLamports(jitoConfig),
                    solToLamports(priorityFeeInSol),
                ),
            };
        }
    }

    async sell({
        transactionMode,
        payerPrivateKey,
        tokenMint,
        tokenBondingCurve,
        tokenAssociatedBondingCurve,
        tokenBalance,
        priorityFeeInSol = Pumpfun.defaultPriorityInSol,
        slippageDecimal = Pumpfun.defaultSlippageDecimal,
        jitoConfig,
    }: {
        transactionMode: TransactionMode;
        payerPrivateKey: string;
        tokenMint: string;
        tokenBondingCurve: string;
        tokenAssociatedBondingCurve: string;
        tokenBalance: number;
        priorityFeeInSol?: number;
        slippageDecimal?: number;
        jitoConfig?: JitoConfig;
    }): Promise<PumpfunSellResponse> {
        const payer = await getKeyPairFromPrivateKey(payerPrivateKey);
        const mint = new PublicKey(tokenMint);

        const txBuilder = new Transaction();

        const tokenAccountAddress = await getAssociatedTokenAddress(mint, payer.publicKey, false);

        const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccountAddress, payer.publicKey, mint),
            );
            tokenAccount = tokenAccountAddress;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const { virtualTokenReserves, virtualSolReserves, priceInSol } =
            await this.getTokenBondingCurveStats(tokenBondingCurve);

        const minLamportsOutput = Math.floor(
            (tokenBalance! * (1 - slippageDecimal) * virtualSolReserves) / virtualTokenReserves,
        );

        const keys: Array<AccountMeta> = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(tokenBondingCurve), isSigner: false, isWritable: true },
            { pubkey: new PublicKey(tokenAssociatedBondingCurve), isSigner: false, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: false, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        ];

        const data = Buffer.concat([
            bufferFromUInt64('12502976635542562355'),
            bufferFromUInt64(tokenBalance),
            bufferFromUInt64(minLamportsOutput),
        ]);

        // @ts-ignore
        const instruction = new TransactionInstruction({
            keys: keys,
            programId: PUMP_FUN_PROGRAM,
            data: data,
        });
        txBuilder.add(instruction);

        if (transactionMode === TransactionMode.Execution) {
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
                jitoConfig?.jitoEnabled,
                jitoConfig?.tipLamports,
                jitoConfig?.endpoint,
            );

            if (sellResult.error) {
                throw sellResult.error;
            }
            const { signature } = sellResult;

            logger.info(`Sell transaction confirmed: https://solscan.io/tx/${signature}`);

            return {
                signature: signature!,
                soldRawAmount: tokenBalance,
                minLamportsOutput: minLamportsOutput,
                txDetails: await getSolTransactionDetails(
                    this.connection,
                    signature!,
                    payer.publicKey.toBase58(),
                    Pumpfun.getTxDetailsRetryConfig,
                ),
            };
        } else {
            // running the simulation incur fees so skipping for now
            // const simulatedResult = await this.connection.simulateTransaction(transaction);
            // logger.info(simulatedResult);

            await sleep(
                simulatePumpSellLatencyMs(
                    priorityFeeInSol,
                    jitoConfig ?? {
                        jitoEnabled: false,
                    },
                    true,
                ),
            );

            return {
                signature: _generateFakeSimulationTransactionHash(),
                soldRawAmount: tokenBalance,
                minLamportsOutput: minLamportsOutput,
                txDetails: simulateSolTransactionDetails(
                    Math.max(
                        minLamportsOutput,
                        simulatePriceWithLowerSlippage(
                            calculatePumpTokenLamportsValue(tokenBalance, priceInSol),
                            slippageDecimal,
                        ),
                    ) - getJitoTipLamports(jitoConfig),
                    solToLamports(priorityFeeInSol),
                ),
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
        const tokenBondingCurvePk = new PublicKey(tokenBondingCurve);

        const bondingCurveAccountInfo = (await this.connection.getAccountInfo(tokenBondingCurvePk))!;
        const bondingCurveState = new BondingCurveState(bondingCurveAccountInfo.data as Buffer);

        const marketCap = lamportsToSol(Number(bondingCurveState.virtual_sol_reserves));
        // dividing by 10^6 (as pump.fun has value till 6 decimal places)
        const totalCoins = Number(bondingCurveState.virtual_token_reserves) / 10 ** PUMPFUN_TOKEN_DECIMALS;
        const price = marketCap / totalCoins;

        // We multiply by 1000_000 as coin have value in 6 decimals
        const reservedTokens = new BN(206900000).mul(new BN(1000_000));
        const initialRealTokenReserves = new BN(Number(bondingCurveState.token_total_supply)).sub(reservedTokens);
        const bondingCurveProgress = new BN(100).sub(
            new BN(Number(bondingCurveState.real_token_reserves)).mul(new BN(100)).div(initialRealTokenReserves),
        );

        return {
            marketCapInSol: marketCap,
            priceInSol: price,
            bondingCurveProgress: bondingCurveProgress.toNumber(),
            virtualSolReserves: Number(bondingCurveState.virtual_sol_reserves),
            virtualTokenReserves: Number(bondingCurveState.virtual_token_reserves),
        };
    }

    public getBondingCurveAddress(mintAddress: PublicKey): PublicKey {
        const [bondingCurve] = PublicKey.findProgramAddressSync(
            [Buffer.from('bonding-curve'), mintAddress.toBytes()],
            PUMP_FUN_PROGRAM,
        );

        return bondingCurve;
    }

    public getAssociatedBondingCurveAddress(bondingCurveAddress: PublicKey, mintAddress: PublicKey) {
        const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
            [bondingCurveAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        return associatedBondingCurve;
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

    /**
     * Trying several ways to get the bonding curve data, this is mandatory to perform a buy or sell
     */
    private async getBcReserves(
        tokenMint: string,
        tokenBondingCurve: string,
    ): Promise<{
        virtualSolReserves: number;
        virtualTokenReserves: number;
    }> {
        const maxTimeoutMs = 1200;

        const [txData, txFromFeApi]: [
            VirtualReserves | null,
            VirtualReserves | null,
            // @ts-ignore
        ] = await Promise.all([
            (async () => {
                try {
                    const r = await new CircuitBreaker(() => this.getTokenBondingCurveStats(tokenBondingCurve), {
                        timeout: maxTimeoutMs,
                    }).fire();

                    return {
                        virtualSolReserves: r.virtualSolReserves,
                        virtualTokenReserves: r.virtualTokenReserves,
                    };
                } catch (_) {
                    return null;
                }
            })(),
            (async () => {
                try {
                    const r = await new CircuitBreaker(() => this.getCoinData(tokenMint), {
                        timeout: maxTimeoutMs,
                    }).fire();

                    return {
                        virtualSolReserves: r.virtual_sol_reserves,
                        virtualTokenReserves: r.virtual_token_reserves,
                    };
                } catch (_) {
                    return null;
                }
            })(),
        ]);

        if (txData === null && txFromFeApi === null) {
            throw new Error(
                `Could not fetch bondingCurve sol and token reserves for mint ${tokenMint}, bc: ${tokenBondingCurve}`,
            );
        }

        return txData ?? txFromFeApi!;
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

export function simulatePumpBuyLatencyMs(
    priorityFeeInSol: number,
    jitoConfig: JitoConfig,
    varyLatency: boolean,
): number {
    const latencies = getLatencyMetrics(pumpfunBuyLatencies, priorityFeeInSol, jitoConfig);

    return varyLatency ? computeSimulatedLatencyNs(latencies) / 1e6 : latencies.avgTimeNs / 1e6;
}

export function simulatePumpSellLatencyMs(
    priorityFeeInSol: number,
    jitoConfig: JitoConfig,
    varyLatency: boolean,
): number {
    const latencies = getLatencyMetrics(pumpfunSellLatencies, priorityFeeInSol, jitoConfig);

    return varyLatency ? computeSimulatedLatencyNs(latencies) / 1e6 : latencies.avgTimeNs / 1e6;
}
