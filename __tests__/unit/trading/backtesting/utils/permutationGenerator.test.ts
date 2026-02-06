import {
    generatePermutationsArray,
    generatePermutationsGenerator,
} from '../../../../../src/trading/backtesting/utils/permutationGenerator';

describe('permutationGenerator', () => {
    // A simple identity validator to use across most tests
    const identityValidator = <T>(data: unknown): T => data as T;

    it('should return a single permutation when no ranges are present', () => {
        const input = { symbol: 'BTCUSDT', value: 100 };
        const result = generatePermutationsArray<typeof input>(input, identityValidator);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(input);
    });

    it('should generate permutations for a single top-level range', () => {
        interface SimpleConfig {
            symbol: string;
            period: number;
        }
        const input = {
            symbol: 'BTCUSDT',
            period: { type: 'range', from: 1, to: 3, step: 1 },
        };
        const result = generatePermutationsArray<SimpleConfig>(input, identityValidator);

        expect(result).toHaveLength(3);
        expect(result).toContainEqual({ symbol: 'BTCUSDT', period: 1 });
        expect(result).toContainEqual({ symbol: 'BTCUSDT', period: 2 });
        expect(result).toContainEqual({ symbol: 'BTCUSDT', period: 3 });
    });

    it('should generate a Cartesian product for nested recursive ranges', () => {
        interface NestedConfig {
            buy: {
                minConfidence: number;
                context: {
                    holders: number;
                };
            };
        }
        const input = {
            buy: {
                minConfidence: { type: 'range', from: 1, to: 2, step: 1 },
                context: {
                    holders: { type: 'range', from: 10, to: 11, step: 1 },
                },
            },
        };

        const result = generatePermutationsArray<NestedConfig>(input, identityValidator);

        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ buy: { minConfidence: 1, context: { holders: 10 } } });
        expect(result[1]).toEqual({ buy: { minConfidence: 1, context: { holders: 11 } } });
        expect(result[2]).toEqual({ buy: { minConfidence: 2, context: { holders: 10 } } });
        expect(result[3]).toEqual({ buy: { minConfidence: 2, context: { holders: 11 } } });
    });

    it('should handle decimal steps with precision', () => {
        interface DecimalConfig {
            threshold: number;
        }
        const input = {
            threshold: { type: 'range', from: 0.1, to: 0.3, step: 0.1 },
        };
        const result = generatePermutationsArray<DecimalConfig>(input, identityValidator);

        expect(result).toHaveLength(3);
        expect(result[0].threshold).toBe(0.1);
        expect(result[1].threshold).toBe(0.2);
        expect(result[2].threshold).toBe(0.3);
    });

    it('should correctly handle ranges inside arrays', () => {
        interface ArrayConfig {
            levels: { price: number }[];
        }
        const input = {
            levels: [{ price: { type: 'range', from: 100, to: 101, step: 1 } }],
        };
        const result = generatePermutationsArray<ArrayConfig>(input, identityValidator);

        expect(result).toHaveLength(2);
        expect(result[0].levels[0].price).toBe(100);
        expect(result[1].levels[0].price).toBe(101);
    });

    it('should work as a generator to save memory', () => {
        const input = {
            a: { type: 'range', from: 1, to: 100, step: 1 },
            b: { type: 'range', from: 1, to: 100, step: 1 },
        };

        const generator = generatePermutationsGenerator(input, identityValidator);
        const first = generator.next().value;

        // We only pulled the first item, we didn't calculate all 10,000 in memory
        expect(first).toEqual({ a: 1, b: 1 });
    });

    it('should use the validator function to transform output', () => {
        const input = { val: { type: 'range', from: 1, to: 2, step: 1 } };

        // Example: The validator adds a suffix
        const customValidator = (d: unknown) => ({ ...(d as Record<string, unknown>), transformed: true });
        const result = generatePermutationsArray(input, customValidator);

        expect(result[0].transformed).toBe(true);
        expect(result[1].transformed).toBe(true);
    });

    it('should verify the Recursive HoldersCount logic (User Example)', () => {
        interface RecursiveConfig {
            buy: {
                minConfidence: number;
                context: {
                    holdersCount: {
                        min: number;
                        max: number;
                    };
                };
            };
        }
        const input = {
            buy: {
                minConfidence: { type: 'range', from: 1, to: 2, step: 1 }, // 1, 2
                context: {
                    holdersCount: {
                        min: { type: 'range', from: 10, to: 10, step: 1 }, // 10
                        max: { type: 'range', from: 100, to: 101, step: 1 }, // 100, 101
                    },
                },
            },
        };

        const result = generatePermutationsArray<RecursiveConfig>(input, identityValidator);
        // 2 (minConf) * 1 (min) * 2 (max) = 4 permutations
        expect(result).toHaveLength(4);
        expect(result[0].buy.context.holdersCount.max).toBe(100);
    });
});
