import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import {
    AccountMeta,
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import WebSocket, { MessageEvent } from 'ws';

import {
    ASSOC_TOKEN_ACC_PROG,
    FEE_RECIPIENT,
    GLOBAL,
    PUMP_FUN_ACCOUNT,
    PUMP_FUN_PROGRAM,
    RENT,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from './constants';
import { NewPumpFunTokenData } from './types';
import { logger } from '../../../../logger';
import { bufferFromUInt64 } from '../../../../utils/data';
import { TransactionMode, WssMessage } from '../../types';
import { createTransaction, getKeyPairFromPrivateKey } from '../../utils/helpers';

type PumpFunCoinData = {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    image_uri: string;
    video_uri: string | null;
    metadata_uri: string;
    twitter: string | null;
    telegram: string | null;
    bonding_curve: string;
    associated_bonding_curve: string;
    creator: string;
    created_timestamp: number;
    raydium_pool: null;
    complete: false;
    virtual_sol_reserves: number;
    virtual_token_reserves: number;
    total_supply: number;
    website: string | null;
    show_name: true;
    king_of_the_hill_timestamp: null;
    market_cap: number;
    reply_count: number;
    last_reply: number;
    nsfw: false;
    market_id: string | null;
    inverted: string | null;
    is_currently_live: boolean;
    username: string | null;
    profile_image: string | null;
    usd_market_cap: number;
};

/**
 * @see https://github.dev/bilix-software/solana-pump-fun
 * If the transactions fail with weird error 'Program Error: "Instruction #4 Failed - Program failed to complete"' like this one
 * https://solscan.io/tx/3jkrwjvPYGcmkqRZYDST7suaqYdtr5qJC9rXKWhSo6pq3SA6zCJ2QRQP5T6FDNiZXh9dnFYADpCuCB4JKvouKaLC
 * you might need to first sign in with the wallet in pump.fun manually to accept the "terms". After can use the code
 *
 * If confirmation of transactions fails, might need to increase priority fee
 */
export default class Pumpfun {
    private static readonly defaultPriorityInSol = 0;
    private static readonly defaultSlippageDecimal = 0.25;

    private listeningToNewTokens = false;
    private ws: WebSocket | undefined;

    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly config: { rpcEndpoint: string; wsEndpoint: string }) {}

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void) {
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

            this.ws!.on('close', async () => {
                if (this.listeningToNewTokens) {
                    logger.debug('Connection closed. Reconnecting in 5 seconds...');
                    await setTimeout(() => {
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
                await setTimeout(() => {
                    this.listenForPumpFunTokens(onNewToken);
                }, 5000);
            } else {
                logger.info('Will not retry connecting because we set listeningToNewTokens=false');
            }
        }
    }

    stopListeningToNewTokens() {
        this.listeningToNewTokens = false;
        this.ws!.close();
    }

    async buy({
        transactionMode,
        payerPrivateKey,
        tokenMint,
        solIn,
        priorityFeeInSol = Pumpfun.defaultPriorityInSol,
        slippageDecimal = Pumpfun.defaultSlippageDecimal,
    }: {
        transactionMode: TransactionMode;
        payerPrivateKey: string;
        tokenMint: string;
        solIn: number;
        priorityFeeInSol?: number;
        slippageDecimal?: number;
    }) {
        const connection = new Connection(this.config.rpcEndpoint, 'confirmed');

        const payer = await getKeyPairFromPrivateKey(payerPrivateKey);
        const owner = payer.publicKey;
        const mint = new PublicKey(tokenMint);

        const txBuilder = new Transaction();

        const tokenAccountAddress = await getAssociatedTokenAddress(mint, owner, false);

        const tokenAccountInfo = await connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccountAddress, payer.publicKey, mint),
            );
            tokenAccount = tokenAccountAddress;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const coinData = await this.getCoinDataWithRetries(tokenMint);

        const solInLamports = solIn * LAMPORTS_PER_SOL;
        const tokenOut = Math.floor((solInLamports * coinData.virtual_token_reserves) / coinData.virtual_sol_reserves);

        const solInWithSlippage = solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solInWithSlippage * LAMPORTS_PER_SOL);
        const ASSOCIATED_USER = tokenAccount;
        const USER = owner;
        const BONDING_CURVE = new PublicKey(coinData.bonding_curve);
        const ASSOCIATED_BONDING_CURVE = new PublicKey(coinData.associated_bonding_curve);

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

        const transaction = await createTransaction(
            connection,
            txBuilder.instructions,
            payer.publicKey,
            priorityFeeInSol,
        );
        if (transactionMode === TransactionMode.Execution) {
            const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
            });
            logger.info(`Buy transaction confirmed: https://solscan.io/tx/${signature}`);
        } else if (transactionMode === TransactionMode.Simulation) {
            const simulatedResult = await connection.simulateTransaction(transaction);
            logger.info(simulatedResult);
        }
    }

    async sell({
        transactionMode,
        payerPrivateKey,
        tokenMint,
        tokenBalance,
        priorityFeeInSol = Pumpfun.defaultPriorityInSol,
        slippageDecimal = Pumpfun.defaultSlippageDecimal,
    }: {
        transactionMode: TransactionMode;
        payerPrivateKey: string;
        tokenMint: string;
        tokenBalance: number;
        priorityFeeInSol?: number;
        slippageDecimal?: number;
    }) {
        const connection = new Connection(this.config.rpcEndpoint, 'confirmed');

        const payer = await getKeyPairFromPrivateKey(payerPrivateKey);
        const owner = payer.publicKey;
        const mint = new PublicKey(tokenMint);

        const txBuilder = new Transaction();

        const tokenAccountAddress = await getAssociatedTokenAddress(mint, owner, false);

        const tokenAccountInfo = await connection.getAccountInfo(tokenAccountAddress);

        let tokenAccount: PublicKey;
        if (!tokenAccountInfo) {
            txBuilder.add(
                createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccountAddress, payer.publicKey, mint),
            );
            tokenAccount = tokenAccountAddress;
        } else {
            tokenAccount = tokenAccountAddress;
        }

        const coinData = await this.getCoinDataWithRetries(tokenMint);

        const minSolOutput = Math.floor(
            (tokenBalance! * (1 - slippageDecimal) * coinData.virtual_sol_reserves) / coinData.virtual_token_reserves,
        );

        const keys: Array<AccountMeta> = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(coinData.bonding_curve), isSigner: false, isWritable: true },
            { pubkey: new PublicKey(coinData.associated_bonding_curve), isSigner: false, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOC_TOKEN_ACC_PROG, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        ];

        const data = Buffer.concat([
            bufferFromUInt64('12502976635542562355'),
            bufferFromUInt64(tokenBalance),
            bufferFromUInt64(minSolOutput),
        ]);

        // @ts-ignore
        const instruction = new TransactionInstruction({
            keys: keys,
            programId: PUMP_FUN_PROGRAM,
            data: data,
        });
        txBuilder.add(instruction);

        const transaction = await createTransaction(
            connection,
            txBuilder.instructions,
            payer.publicKey,
            priorityFeeInSol,
        );

        if (transactionMode === TransactionMode.Execution) {
            const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
            });
            logger.info(`Sell transaction confirmed: https://solscan.io/tx/${signature}`);
        } else if (transactionMode === TransactionMode.Simulation) {
            const simulatedResult = await connection.simulateTransaction(transaction);
            logger.info(simulatedResult);
        }
    }

    private async getCoinDataWithRetries(tokenMint: string): Promise<PumpFunCoinData> {
        let coinData: PumpFunCoinData | undefined;
        let retries = 0;
        do {
            try {
                coinData = await this.getCoinData(tokenMint);
            } catch (e) {
                logger.error(`failed to fetch coin data on retry ${retries}, error: %s`, (e as Error).message);
            }
        } while (!coinData && retries++ < 3);

        if (!coinData) {
            throw new Error(`Could not fetch coinData for mint ${tokenMint}`);
        }

        return coinData;
    }

    async getCoinData(tokenMint: string): Promise<PumpFunCoinData> {
        const url = `https://frontend-api.pump.fun/coins/${tokenMint}`;
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
