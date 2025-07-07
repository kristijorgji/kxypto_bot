import { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

import { measureExecutionTime } from '@src/apm/apm';
import { RetryConfig } from '@src/core/types';
import { sleep } from '@src/utils/functions';

import { BASE_FEE_LAMPORTS } from '../constants/core';
import { SolFullTransactionDetails, SolTransactionDetails } from '../types';

/**
 * Fetches the lamports transferred (net & gross) and transaction fees from a Solana transaction.
 * grossTransferredLamports is positive for sale transactions and negative for buy
 */
const _getSolTransactionDetails = async (
    connection: Connection,
    transactionSignature: string,
    recipientAddress: string,
    { maxRetries, sleepMs }: RetryConfig,
): Promise<SolFullTransactionDetails> => {
    let transaction: ParsedTransactionWithMeta | null;
    let retries = 0;

    do {
        transaction = await connection.getParsedTransaction(transactionSignature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
            sleepMs = typeof sleepMs === 'function' ? sleepMs(retries + 1) : sleepMs;
            if (sleepMs > 0) {
                await sleep(sleepMs);
            }
        }
    } while (!transaction && retries++ < maxRetries);

    if (!transaction) {
        throw new Error('Transaction not found!');
    }

    return {
        ...parseSolTransactionDetails(transaction, recipientAddress),
        fullTransaction: transaction,
    };
};

export const getSolTransactionDetails = (
    connection: Connection,
    transactionSignature: string,
    recipientAddress: string,
    retryConfig: RetryConfig,
) =>
    measureExecutionTime(
        () => _getSolTransactionDetails(connection, transactionSignature, recipientAddress, retryConfig),
        'getSolTransactionDetails',
        {
            storeImmediately: true,
        },
    );

export function parseSolTransactionDetails(
    transaction: ParsedTransactionWithMeta,
    recipientAddress: string,
): SolTransactionDetails {
    const recipientPublicKey = new PublicKey(recipientAddress);
    let netReceivedLamports = 0;

    transaction.meta?.postBalances.forEach((postBalance, index) => {
        const preBalance = transaction.meta?.preBalances[index] || 0;
        const balanceChange = postBalance - preBalance;
        const accountKey = transaction.transaction.message.accountKeys[index];

        if (accountKey.pubkey.equals(recipientPublicKey)) {
            netReceivedLamports += balanceChange;
        }
    });

    const totalFeeLamports = transaction.meta?.fee || 0;

    // Estimate base fee (default is 5000 lamports for simple transfers)
    const estimatedBaseFeeLamports = BASE_FEE_LAMPORTS;

    // Priority fee (total fee - base fee)
    const priorityFeeLamports = Math.max(totalFeeLamports - estimatedBaseFeeLamports, 0);

    // Gross amount sent before fees (total amount transferred, not just net received)
    const grossReceivedLamports = netReceivedLamports + totalFeeLamports;

    const r: SolTransactionDetails = {
        grossTransferredLamports: grossReceivedLamports,
        netTransferredLamports: netReceivedLamports,
        baseFeeLamports: estimatedBaseFeeLamports,
        priorityFeeLamports,
        totalFeeLamports,
    };

    if (transaction.meta?.err) {
        r.error = transaction.meta?.err;
    }

    return r;
}
