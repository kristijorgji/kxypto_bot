import { AggregationMode } from '@src/trading/strategies/types';
import { calculateMedian, calculateWeightedAverage, getRecencyWeights } from '@src/utils/math';

export function aggregateValue(mode: AggregationMode, values: number[], weights?: number[]): number {
    if (values.length === 0) return 0; // Guard against empty arrays

    switch (mode) {
        case 'mean':
            return values.reduce((acc, c) => acc + c, 0) / values.length;
        case 'median':
            return calculateMedian(values);
        case 'weighted':
            return calculateWeightedAverage(values, weights!);
        case 'max':
            return Math.max(...values);
        case 'min':
            return Math.min(...values);
        case 'recency_weighted': {
            const rWeights = getRecencyWeights(values.length, 0.5);
            return calculateWeightedAverage(values, rWeights);
        }
        default:
            throw new Error(`Unsupported aggregation mode ${mode}`);
    }
}
