import { randomDecimal, randomInt } from '../../../src/utils/data';

describe(randomInt.name, () => {
    test('returns a number within the given range', () => {
        for (let i = 0; i < 100; i++) {
            const result = randomInt(1, 10);
            expect(result).toBeGreaterThanOrEqual(1);
            expect(result).toBeLessThanOrEqual(10);
        }
    });

    test('returns the same number when min and max are equal', () => {
        expect(randomInt(5, 5)).toBe(5);
    });

    test.each([
        [0, 0],
        [1, 10],
        [-5, 5],
        [100, 200],
    ])('returns values in range [%d, %d]', (min, max) => {
        for (let i = 0; i < 100; i++) {
            const result = randomInt(min, max);
            expect(result).toBeGreaterThanOrEqual(min);
            expect(result).toBeLessThanOrEqual(max);
        }
    });

    test('handles negative ranges correctly', () => {
        for (let i = 0; i < 100; i++) {
            const result = randomInt(-10, -1);
            expect(result).toBeGreaterThanOrEqual(-10);
            expect(result).toBeLessThanOrEqual(-1);
        }
    });
});

describe(randomDecimal.name, () => {
    test.each([
        [0.001, 0.004, 3],
        [1.5, 2.5, 2],
        [-5.5, -2.5, 2],
        [10, 20, 0],
        [0, 1, 5],
    ])('returns a random number between %f and %f with %d decimals', (min, max, decimals) => {
        const result = randomDecimal(min, max, decimals);
        console.log(result);

        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);

        const decimalPlaces = result.toString().split('.')[1]?.length || 0;
        expect(decimalPlaces).toBeLessThanOrEqual(decimals);
    });
});
