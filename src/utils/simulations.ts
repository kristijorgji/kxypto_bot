export type LatencyMetrics = {
    minTimeNs: number;
    maxTimeNs: number;
    avgTimeNs: number;
    medianTimeNs: number;
};

export function computeSimulatedLatencyNs({ minTimeNs, maxTimeNs, avgTimeNs, medianTimeNs }: LatencyMetrics): number {
    const randomFactor = Math.random(); // Value between 0 and 1

    if (medianTimeNs < avgTimeNs) {
        // Swap them if they are reversed
        [avgTimeNs, medianTimeNs] = [medianTimeNs, avgTimeNs];
    }

    let sleepTimeNs: number;

    if (randomFactor < 0.33) {
        // 33% of values: minTimeNs → avgTimeNs
        sleepTimeNs = minTimeNs + randomFactor * (avgTimeNs - minTimeNs);
    } else if (randomFactor < 0.83) {
        // 50% of values: avgTimeNs → medianTimeNs
        sleepTimeNs = avgTimeNs + (randomFactor - 0.33) * (medianTimeNs - avgTimeNs);
    } else {
        // 17% of values: medianTimeNs → maxTimeNs
        sleepTimeNs = medianTimeNs + (randomFactor - 0.83) * (maxTimeNs - medianTimeNs);
    }

    return Math.round(sleepTimeNs);
}
