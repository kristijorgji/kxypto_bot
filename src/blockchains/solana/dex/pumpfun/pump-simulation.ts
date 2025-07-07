import { pumpfunBuyLatencies, pumpfunSellLatencies } from '@src/blockchains/solana/dex/pumpfun/data/latencies';
import { JitoConfig } from '@src/blockchains/solana/Jito';
import { getLatencyMetrics } from '@src/blockchains/solana/utils/simulations';
import { computeSimulatedLatencyNs } from '@src/utils/simulations';

export function simulatePumpBuyLatencyMs(
    priorityFeeInSol: number,
    jitoConfig: JitoConfig,
    varyLatency: boolean,
): number {
    const latencies = getLatencyMetrics(pumpfunBuyLatencies, priorityFeeInSol, jitoConfig);

    return varyLatency ? computeSimulatedLatencyNs(latencies) / 1e6 : latencies.avgTimeNs / 1e6;
}

export function simulatePumpSellLatencyMs(
    priorityFeeInSol: number,
    jitoConfig: JitoConfig,
    varyLatency: boolean,
): number {
    const latencies = getLatencyMetrics(pumpfunSellLatencies, priorityFeeInSol, jitoConfig);

    return varyLatency ? computeSimulatedLatencyNs(latencies) / 1e6 : latencies.avgTimeNs / 1e6;
}

export function simulatePumpAccountCreationFeeLamports(): number {
    return 4045000;
}
