import { randomDecimal } from '../../../utils/data/data';
import { solToLamports } from '../../utils/amount';
import { BASE_FEE_LAMPORTS } from '../constants/core';
import { SolTransactionDetails } from '../types';

const minPriorityFeeLamports = solToLamports(0.001);
const maxPriorityFeeLamports = solToLamports(0.005);

type TransactionFee = {
    priorityFeeLamports: number;
    totalFeeLamports: number;
};

export function simulateSolanaPriorityFeeInLamports(): number {
    return randomDecimal(minPriorityFeeLamports, maxPriorityFeeLamports, 2);
}

export function simulateSolanaFeesInLamports(): TransactionFee {
    const priorityFeeLamports = simulateSolanaPriorityFeeInLamports();

    return {
        priorityFeeLamports: priorityFeeLamports,
        totalFeeLamports: BASE_FEE_LAMPORTS + priorityFeeLamports,
    };
}

export function simulateSolTransactionDetails(
    lamportsValue: number,
    priorityFeeLamports?: number,
): SolTransactionDetails {
    const simPriorityFee: TransactionFee = priorityFeeLamports
        ? {
              priorityFeeLamports: priorityFeeLamports,
              totalFeeLamports: BASE_FEE_LAMPORTS + priorityFeeLamports,
          }
        : simulateSolanaFeesInLamports();

    return {
        grossTransferredLamports: lamportsValue,
        netTransferredLamports: lamportsValue - simPriorityFee.totalFeeLamports,
        baseFeeLamports: BASE_FEE_LAMPORTS,
        priorityFeeLamports: simPriorityFee.priorityFeeLamports,
        totalFeeLamports: simPriorityFee.totalFeeLamports,
    };
}

/**
 * It will simulate a price within the allowed slippage range
 */
export function simulatePriceWithSlippage(lamportsPrice: number, slippageDecimal: number): number {
    // Generate a random slippage within [-slippageDecimal, slippageDecimal]
    const randomSlippage = (Math.random() * 2 - 1) * slippageDecimal;

    const slippageMultiplier = 1 + randomSlippage;

    return lamportsPrice * slippageMultiplier;
}

/**
 * It will simulate a price with slippage a random slippage in the range [-slippageDecimal, 0]
 * This is used for simulating sell price during stop loss, when market price is going lower
 */
export function simulatePriceWithLowerSlippage(lamportsPrice: number, slippageDecimal: number): number {
    // Generate a random slippage within [0, slippageDecimal]
    const randomSlippage = Math.random() * slippageDecimal;

    const slippageMultiplier = 1 - randomSlippage;

    return lamportsPrice * slippageMultiplier;
}

/**
 * It will simulate a price with slippage a random slippage in the range [0, slippageDecimal]
 * This is used for simulating buy price when market price is going higher
 */
export function simulatePriceWithHigherSlippage(lamportsPrice: number, slippageDecimal: number): number {
    // Generate a random slippage within [0, slippageDecimal]
    const randomSlippage = Math.random() * slippageDecimal;

    const slippageMultiplier = 1 + randomSlippage;

    return lamportsPrice * slippageMultiplier;
}
