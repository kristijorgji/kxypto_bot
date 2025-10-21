import { AggregationMode } from '@src/trading/strategies/types';
import { calculateMedian, calculateWeightedAverage } from '@src/utils/math';

export function aggregateValue(mode: AggregationMode, values: number[], weights?: number[]): number {
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
        default:
            throw new Error(`Unsupported aggregation mode ${mode}`);
    }
}
