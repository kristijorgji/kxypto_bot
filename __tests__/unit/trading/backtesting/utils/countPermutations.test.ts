import { countPermutations } from '../../../../../src/trading/backtesting/utils/countPermutations';

describe('countPermutations', () => {
    it('should return 1 for a plain object with no ranges', () => {
        const input = { a: 1, b: 'test', c: { d: 2 } };
        expect(countPermutations(input)).toBe(1);
    });

    it('should calculate steps for a single range', () => {
        const input = {
            threshold: { type: 'range', from: 10, to: 50, step: 10 }, // 10, 20, 30, 40, 50
        };
        expect(countPermutations(input)).toBe(5);
    });

    it('should calculate Cartesian product of multiple ranges', () => {
        const input = {
            stopLoss: { type: 'range', from: 1, to: 3, step: 1 }, // 3 values: 1, 2, 3
            takeProfit: { type: 'range', from: 10, to: 12, step: 1 }, // 3 values: 10, 11, 12
        };

        // 3 * 3 = 9
        expect(countPermutations(input)).toBe(9);
    });

    it('should handle deeply nested ranges and recursive object structures', () => {
        const input = {
            buy: {
                minConfidence: {
                    type: 'range',
                    from: 1,
                    to: 3,
                    step: 1,
                }, // 3 values: 1, 2, 3
                context: {
                    holdersCount: {
                        min: {
                            type: 'range',
                            from: 1,
                            to: 100,
                            step: 1,
                        }, // 100 values: 1...100
                        max: {
                            type: 'range',
                            from: 100,
                            to: 110,
                            step: 1,
                        }, // 11 values: 100...110
                    },
                },
            },
        };

        // Calculation: 3 (minConfidence) * 100 (min) * 11 (max) = 3300
        expect(countPermutations(input)).toBe(3300);
    });

    it('should handle deeply nested ranges in arrays', () => {
        const input = {
            strategies: [
                {
                    params: {
                        period: { type: 'range', from: 5, to: 25, step: 5 }, // 5 values: 5, 10, 15, 20, 25
                    },
                },
            ],
            global: {
                multiplier: { type: 'range', from: 1, to: 2, step: 1 }, // 2 values: 1, 2
            },
        };
        // 5 * 2 = 10
        expect(countPermutations(input)).toBe(10);
    });

    it('should handle decimal steps correctly', () => {
        const input = {
            val: { type: 'range', from: 0.1, to: 0.5, step: 0.1 }, // 0.1, 0.2, 0.3, 0.4, 0.5
        };
        expect(countPermutations(input)).toBe(5);
    });

    it('should return 0 if a range is impossible (from > to)', () => {
        const input = {
            val: { type: 'range', from: 100, to: 50, step: 10 },
        };
        expect(countPermutations(input)).toBe(0);
    });

    it('should handle arrays containing ranges', () => {
        const input = [
            { val: { type: 'range', from: 1, to: 2, step: 1 } },
            { val: { type: 'range', from: 1, to: 3, step: 1 } },
        ];
        // 2 * 3 = 6
        expect(countPermutations(input)).toBe(6);
    });
});
