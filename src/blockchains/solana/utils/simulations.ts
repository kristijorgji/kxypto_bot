import { randomDecimal } from '../../../utils/data/data';
import { lamportsToSol } from '../../utils/amount';
import { BASE_FEE_LAMPORTS } from '../constants/core';
import { SolTransactionDetails } from '../types';

export function simulateSolanaFeesInLamports(): {
    priorityFeeLamports: number;
    totalFeeLamports: number;
} {
    const minPriorityFeeLamports = lamportsToSol(0.001);
    const maxPriorityFeeLamports = lamportsToSol(0.005);

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
