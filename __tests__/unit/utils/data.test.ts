import { getRandomDecimal } from '../../../src/blockchains/utils/data';

describe(getRandomDecimal.name, () => {
    test.each([
        [0.001, 0.004, 3],
        [1.5, 2.5, 2],
        [-5.5, -2.5, 2],
        [10, 20, 0],
        [0, 1, 5],
    ])('returns a random number between %f and %f with %d decimals', (min, max, decimals) => {
        const result = getRandomDecimal(min, max, decimals);
        console.log(result);

        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);

        const decimalPlaces = result.toString().split('.')[1]?.length || 0;
        expect(decimalPlaces).toBeLessThanOrEqual(decimals);
    });
});
