import { Connection, Keypair } from '@solana/web3.js';

import { calculatePriorityFee } from './calculatePriorityFee';
import { TransactionResult, executeTransactions } from './executeTransactions';
import { getOrCreateWalletTokenAccounts } from './getOrCreateWalletTokenAccounts';
import { getRaydiumQuote } from './getRaydiumQuote';
import { getSwapTransactions } from './getSwapTransactions';
import { SolanaTokenMints } from '../../constants/SolanaTokenMints';
import { TransactionMode } from '../../types';

export type RaydiumSwapConfig = {
    wallet: Keypair;
    transactionMode: TransactionMode;
    inputAmount: number;
    inputMint: string;
    outputMint: string;
    maxPriorityFee?: number;
    slippageInPercent: number;
    connection: Connection;
};

export async function swap({
    connection,
    wallet,
    transactionMode,
    inputAmount,
    inputMint,
    outputMint,
    maxPriorityFee = 50_000,
    slippageInPercent,
}: RaydiumSwapConfig): Promise<TransactionResult[]> {
    const [isInputSol, isOutputSol] = [inputMint === SolanaTokenMints.WSOL, outputMint === SolanaTokenMints.WSOL];

    const [tokenAccounts, swapCompute, priorityFee] = await Promise.all([
        getOrCreateWalletTokenAccounts({
            connection,
            wallet,
            inputMint,
            outputMint,
        }),
        getRaydiumQuote({
            inputAmount,
            inputMint,
            outputMint,
            slippageInPercent,
        }),
        calculatePriorityFee({
            max: maxPriorityFee,
            optimizePriorityFee: true,
        }),
    ]);

    const swapTransactions = await getSwapTransactions({
        priorityFee: priorityFee,
        swapResponse: swapCompute,
        wallet: wallet,
        isInputSol: isInputSol,
        isOutputSol: isOutputSol,
        tokenAccounts: tokenAccounts,
    });

    return await executeTransactions({
        connection: connection,
        wallet: wallet,
        transactionMode: transactionMode,
        swapTransactions: swapTransactions,
    });
}
