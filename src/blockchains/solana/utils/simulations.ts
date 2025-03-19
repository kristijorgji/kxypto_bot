import { randomDecimal } from '../../../utils/data/data';
import { LatencyMetrics } from '../../../utils/simulations';
import { solToLamports } from '../../utils/amount';
import { BASE_FEE_LAMPORTS } from '../constants/core';
import { JitoConfig, TIP_LAMPORTS } from '../Jito';
import { ExecutionLatencyData, SolTransactionDetails } from '../types';

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

/**
 * Retrieves the appropriate latency metrics based on the execution configuration.
 *
 * - If Jito is enabled, it selects latency data based on the closest available tip amount.
 * - Otherwise, it uses RPC latency data, prioritizing the closest matching priority fee.
 * - If no exact match is found, it falls back to the nearest available entry.
 *
 */
export function getLatencyMetrics(
    data: ExecutionLatencyData,
    priorityFeeInSol: number,
    jitoConfig: JitoConfig,
): LatencyMetrics {
    if (jitoConfig.jitoEnabled) {
        return findNearestValue(data.jito.tip, jitoConfig.tipLamports ?? TIP_LAMPORTS) ?? data.jito.default;
    }

    return findNearestValue(data.rpc.priorityFee, priorityFeeInSol) ?? data.rpc.default;
}

/**
 * Finds the nearest available key in an object based on numerical keys.
 * @param obj - The object containing numerical keys.
 * @param target - The target number to find the closest match for.
 * @returns The value associated with the closest key.
 */
function findNearestValue<T>(obj: Record<number, T>, target: number): T | undefined {
    const keys = Object.keys(obj).map(Number); // Convert keys to numbers
    if (keys.length === 0) {
        return undefined;
    }

    const closestKey = keys.reduce((prev, curr) => (Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev));

    return obj[closestKey];
}
