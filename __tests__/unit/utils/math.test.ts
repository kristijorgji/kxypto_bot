import { calculateMedian, calculateWeightedAverage, getRecencyWeights } from '../../../src/utils/math';

describe('calculateMedian', () => {
    test('should return the middle element for an array with an odd number of elements', () => {
        const oddArray = [1, 5, 2, 8, 4];
        expect(calculateMedian(oddArray)).toBe(4);
    });

    test('should work correctly with an already sorted odd array', () => {
        const sortedOddArray = [1, 2, 4, 5, 8];
        expect(calculateMedian(sortedOddArray)).toBe(4);
    });

    test('should work correctly with a reverse-sorted odd array', () => {
        const reverseSortedOddArray = [8, 5, 4, 2, 1];
        expect(calculateMedian(reverseSortedOddArray)).toBe(4);
    });

    test('should return the average of the two middle elements for an even array', () => {
        const evenArray = [10, 20, 30, 40];
        expect(calculateMedian(evenArray)).toBe(25); // (20 + 30) / 2
    });

    test('should work correctly with a different even array', () => {
        const anotherEvenArray = [3, 1, 4, 2];
        expect(calculateMedian(anotherEvenArray)).toBe(2.5); // (2 + 3) / 2
    });

    test('should work correctly with an already sorted even array', () => {
        const sortedEvenArray = [1, 2, 3, 4];
        expect(calculateMedian(sortedEvenArray)).toBe(2.5);
    });

    test('should return the single element for a one-element array', () => {
        const singleElementArray = [42];
        expect(calculateMedian(singleElementArray)).toBe(42);
    });

    test('should handle arrays with duplicate values correctly', () => {
        const duplicateArray = [5, 2, 5, 1, 8];
        expect(calculateMedian(duplicateArray)).toBe(5);
    });

    test('should handle negative numbers correctly', () => {
        const negativeArray = [-5, -1, -10, -2, -8];
        expect(calculateMedian(negativeArray)).toBe(-5);
    });

    test('should throw an error for an empty array', () => {
        const emptyArray: number[] = [];
        // Use an arrow function to wrap the function call that is expected to throw
        expect(() => calculateMedian(emptyArray)).toThrow('The provided array is empty');
    });
});

describe('calculateWeightedAverage', () => {
    test('should calculate the weighted average correctly', () => {
        const values = [10, 20, 30, 40];
        const weights = [0.1, 0.2, 0.3, 0.4];
        expect(calculateWeightedAverage(values, weights)).toBe(30); // (10*0.1 + 20*0.2 + 30*0.3 + 40*0.4) / (0.1+0.2+0.3+0.4) = 30
    });

    test('should return 0 for empty arrays', () => {
        const values: number[] = [];
        const weights: number[] = [];
        expect(calculateWeightedAverage(values, weights)).toBe(0);
    });

    test('should throw an error if arrays have different lengths', () => {
        const values = [1, 2];
        const weights = [1];
        expect(() => calculateWeightedAverage(values, weights)).toThrow(
            'The arrays of values and weights must have the same length.',
        );
    });

    test('should handle zero total weight correctly', () => {
        const values = [10, 20, 30];
        const weights = [0, 0, 0];
        expect(calculateWeightedAverage(values, weights)).toBe(0);
    });

    test('should work with different types of numbers', () => {
        const values = [1.5, 2.5, 3.5];
        const weights = [1, 2, 3];
        expect(calculateWeightedAverage(values, weights)).toBe(2.8333333333333335); // (1.5*1 + 2.5*2 + 3.5*3) / (1+2+3)
    });
});

describe('getRecencyWeights', () => {
    test('should return an empty array if n is 0', () => {
        expect(getRecencyWeights(0)).toEqual([]);
    });

    test('should produce weights that sum to 1', () => {
        const weights = getRecencyWeights(5, 0.5);
        const sum = weights.reduce((acc, w) => acc + w, 0);
        expect(sum).toBeCloseTo(1, 10);
    });

    test('should produce strictly increasing weights for positive alpha', () => {
        const weights = getRecencyWeights(4, 0.5);
        // Each subsequent weight should be larger than the previous one
        for (let i = 1; i < weights.length; i++) {
            expect(weights[i]).toBeGreaterThan(weights[i - 1]);
        }
    });

    test('should calculate exact weights for a known small case', () => {
        // n=2, alpha=1.0
        // i=1: exp(1*(1-2)) = exp(-1) ≈ 0.367879
        // i=2: exp(1*(2-2)) = exp(0)  = 1
        // sum ≈ 1.367879
        // w1 = 0.367879 / 1.367879 ≈ 0.2689
        // w2 = 1 / 1.367879 ≈ 0.7311
        const weights = getRecencyWeights(2, 1.0);
        expect(weights[0]).toBeCloseTo(0.2689, 4);
        expect(weights[1]).toBeCloseTo(0.7311, 4);
    });

    test('should be numerically stable for large alpha or n (overflow protection)', () => {
        // We use alpha=10 and n=100.
        // This is stable because we subtract the max index before exp().
        const weights = getRecencyWeights(100, 10.0);

        // 1. The sum must still be 1
        const sum = weights.reduce((acc, w) => acc + w, 0);
        expect(sum).toBeCloseTo(1, 10);

        // 2. The last weight should be the largest (near 1, but not exactly 1)
        expect(weights[weights.length - 1]).toBeGreaterThan(0.99);

        // 3. It should not contain NaN or Infinity
        weights.forEach(w => {
            expect(Number.isFinite(w)).toBe(true);
            expect(isNaN(w)).toBe(false);
        });
    });

    test('should return equal weights if alpha is 0', () => {
        const n = 4;
        const weights = getRecencyWeights(n, 0);
        weights.forEach(w => {
            expect(w).toBeCloseTo(1 / n, 10);
        });
    });
});
