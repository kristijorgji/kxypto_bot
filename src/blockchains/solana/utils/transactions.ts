import { Connection, PublicKey } from '@solana/web3.js';

import { BASE_FEE_LAMPORTS } from '../constants/core';
import { SolTransactionDetails } from '../types';

/**
 * Fetches the lamports transferred (net & gross) and transaction fees from a Solana transaction.
 * grossTransferredLamports is positive for sale transactions and negative for buy
 */
export async function getSolTransactionDetails(
    connection: Connection,
    transactionSignature: string,
    recipientAddress: string,
): Promise<SolTransactionDetails> {
    const transaction = await connection.getParsedTransaction(transactionSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });

    if (!transaction) {
        throw new Error('Transaction not found!');
    }

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

    return {
        grossTransferredLamports: grossReceivedLamports,
        netTransferredLamports: netReceivedLamports,
        baseFeeLamports: estimatedBaseFeeLamports,
        priorityFeeLamports,
        totalFeeLamports,
    };
}
