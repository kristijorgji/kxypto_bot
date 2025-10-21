import { calculateMedian, calculateWeightedAverage } from '@src/utils/math';

import { aggregateValue } from '../../../../src/trading/strategies/aggregation';

jest.mock('@src/utils/math', () => ({
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

    it('should throw an error for unsupported mode', () => {
        // @ts-expect-error testing invalid mode
        expect(() => aggregateValue('invalidMode', values)).toThrow('Unsupported aggregation mode invalidMode');
    });
});
