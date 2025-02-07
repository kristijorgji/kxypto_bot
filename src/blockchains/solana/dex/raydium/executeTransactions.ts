import {
    Connection,
    Keypair,
    SignatureResult,
    SimulatedTransactionResponse,
    VersionedTransaction,
} from '@solana/web3.js';

import { logger } from '../../../../logger';
import { TransactionMode } from '../../types';

type ExecuteTransactionConfig = {
    connection: Connection;
    swapTransactions: VersionedTransaction[];
    wallet: Keypair;
    transactionMode: TransactionMode;
};

type ExecutedTransactionResult = {
    singatureResult: SignatureResult;
    solscanUrl: string;
};

export type TransactionResult = SimulatedTransactionResponse | ExecutedTransactionResult;

async function simulateTransaction(
    connection: Connection,
    transaction: VersionedTransaction,
): Promise<SimulatedTransactionResponse> {
    const simulation = await connection.simulateTransaction(transaction);
    return simulation.value;
}

async function sendAndConfirmTransaction(
    connection: Connection,
    transaction: VersionedTransaction,
): Promise<ExecutedTransactionResult> {
    const [{ lastValidBlockHeight, blockhash }, signature] = await Promise.all([
        connection.getLatestBlockhash({ commitment: 'finalized' }),
        connection.sendTransaction(transaction, {
            skipPreflight: true,
            preflightCommitment: 'processed',
        }),
    ]);

    const confirmation = await connection.confirmTransaction({
        signature: signature,
        lastValidBlockHeight: lastValidBlockHeight,
        blockhash: blockhash,
    });

    return {
        singatureResult: confirmation.value,
        solscanUrl: `https://solscan.io/tx/${signature}`,
    };
}

export async function executeTransactions({
    connection,
    swapTransactions,
    wallet,
    transactionMode,
}: ExecuteTransactionConfig): Promise<TransactionResult[]> {
    logger.info(`Executing ${swapTransactions.length} transactions`);

    const transactionPromises = swapTransactions.map(transaction => {
        transaction.sign([wallet]);
        switch (transactionMode) {
            case TransactionMode.Simulation:
                return simulateTransaction(connection, transaction);
            case TransactionMode.Execution:
                return sendAndConfirmTransaction(connection, transaction);
            default: {
                throw new Error(`Unsupported transaction mode: ${transactionMode}`);
            }
        }
    });

    return Promise.all(transactionPromises);
}
