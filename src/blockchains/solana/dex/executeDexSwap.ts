import { SimulatedTransactionResponse } from '@solana/web3.js';

import { getJupiterQuote } from './jupiter/getJupiterQuote';
import { ExecutedTransactionResult, TransactionResult } from './raydium/executeTransactions';
import { getRaydiumQuote } from './raydium/getRaydiumQuote';

type DexSwapConfig = {
    inputMint: string;
    outputMint: string;
    inputAmount: number;
    slippageInPercent: number;
};

type DexSwapStrategy =
    | { type: 'low_fees'; config: DexSwapConfig }
    | { type: 'speed'; config: DexSwapConfig }
    | { type: 'best_rate'; config: DexSwapConfig };

export async function executeDexSwap(swapStrategy: DexSwapStrategy): Promise<TransactionResult> {
    const quotes = await Promise.all([getJupiterQuote(swapStrategy.config), getRaydiumQuote(swapStrategy.config)]);

    // Depending on the strategy, choose the best quote
    const jupiterQupte = quotes[0];
    const raydiumQuote = quotes[1];

    switch (swapStrategy.type) {
        case 'low_fees':
            return await executeLowFeesSwap(jupiterQupte, raydiumQuote);
        case 'speed':
            return await executeSpeedSwap(jupiterQupte, raydiumQuote);
        case 'best_rate':
            return await executeBestRateSwap(jupiterQupte, raydiumQuote);
    }
}

async function executeLowFeesSwap(jupiterQuote: unknown, raydiumQuote: unknown): Promise<TransactionResult> {
    // Implement the logic to choose the best quote
    return Promise.resolve({} as SimulatedTransactionResponse);
}

async function executeSpeedSwap(jupiterQuote: unknown, raydiumQuote: unknown): Promise<TransactionResult> {
    // Implement the logic to choose the best quote
    return Promise.resolve({} as ExecutedTransactionResult);
}

async function executeBestRateSwap(jupiterQuote: unknown, raydiumQuote: unknown): Promise<TransactionResult> {
    // Implement the logic to choose the best quote
    return Promise.resolve({} as ExecutedTransactionResult);
}
