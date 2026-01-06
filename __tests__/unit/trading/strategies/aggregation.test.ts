import { calculateMedian, calculateWeightedAverage } from '@src/utils/math';

import { aggregateValue } from '../../../../src/trading/strategies/aggregation';

jest.mock('@src/utils/math', () => ({
    ...jest.requireActual('@src/utils/math'),
    calculateMedian: jest.fn(),
    calculateWeightedAverage: jest.fn(),
}));

describe('aggregateValue', () => {
    const values = [1, 2, 3, 4, 5];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should compute mean correctly', () => {
        const result = aggregateValue('mean', values);
        expect(result).toBe(3);
    });

    it('should call calculateMedian for median mode', () => {
        (calculateMedian as jest.Mock).mockReturnValue(3);
        const result = aggregateValue('median', values);
        expect(calculateMedian).toHaveBeenCalledWith(values);
        expect(result).toBe(3);
    });

    it('should call calculateWeightedAverage for weighted mode', () => {
        const weights = [0.1, 0.2, 0.3, 0.2, 0.2];
        (calculateWeightedAverage as jest.Mock).mockReturnValue(2.8);
        const result = aggregateValue('weighted', values, weights);
        expect(calculateWeightedAverage).toHaveBeenCalledWith(values, weights);
        expect(result).toBe(2.8);
    });

    it('should compute max correctly', () => {
        const result = aggregateValue('max', values);
        expect(result).toBe(5);
    });

    it('should compute min correctly', () => {
        const result = aggregateValue('min', values);
        expect(result).toBe(1);
    });

    it('should call calculateWeightedAverage with generated exponential weights for recency_weighted mode', () => {
        (calculateWeightedAverage as jest.Mock).mockReturnValue(4.2);

        const result = aggregateValue('recency_weighted', values);

        // Capture the weights passed to the mock
        const calledWeights = (calculateWeightedAverage as jest.Mock).mock.calls[0][1];

        // 1. Verify it called the utility
        expect(calculateWeightedAverage).toHaveBeenCalledWith(values, expect.any(Array));

        // 2. Verify weights are normalized (sum to approximately 1)
        const sum = (calledWeights as number[]).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 5);

        // 3. Verify the "recency" property: weights should be strictly increasing
        // because alpha (0.5) is positive and values are ordered
        for (let i = 1; i < calledWeights.length; i++) {
            expect(calledWeights[i]).toBeGreaterThan(calledWeights[i - 1]);
        }

        expect(result).toBe(4.2);
    });

    it('should throw an error for unsupported mode', () => {
        // @ts-expect-error testing invalid mode
        expect(() => aggregateValue('invalidMode', values)).toThrow('Unsupported aggregation mode invalidMode');
    });
});
