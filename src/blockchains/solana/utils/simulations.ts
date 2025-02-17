import { randomDecimal } from '../../../utils/data/data';
import { solToLamports } from '../../utils/amount';
import { BASE_FEE_LAMPORTS } from '../constants/core';
import { SolTransactionDetails } from '../types';

const minPriorityFeeLamports = solToLamports(0.001);
const maxPriorityFeeLamports = solToLamports(0.005);

export function simulateSolanaFeesInLamports(): {
    priorityFeeLamports: number;
    totalFeeLamports: number;
} {
    const priorityFeeLamports = randomDecimal(minPriorityFeeLamports, maxPriorityFeeLamports, 2);

    return {
        priorityFeeLamports: priorityFeeLamports,
        totalFeeLamports: BASE_FEE_LAMPORTS + priorityFeeLamports,
    };
}

export function simulateSolTransactionDetails(lamportsValue: number): SolTransactionDetails {
    const simPriorityFee = simulateSolanaFeesInLamports();

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
