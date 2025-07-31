import { pickRandomItem, randomDecimal, randomInt, shuffle } from '../../../../src/utils/data/data';

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

        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);

        const decimalPlaces = result.toString().split('.')[1]?.length || 0;
        expect(decimalPlaces).toBeLessThanOrEqual(decimals);
    });
});

describe('pickRandomItem', () => {
    it('should throw an error for an empty array', () => {
        const emptyArray: never[] = [];
        expect(() => pickRandomItem(emptyArray)).toThrow('Cannot pick a random item from an empty array.');
        expect(() => pickRandomItem(emptyArray)).toThrow(Error); // Also check it throws an instance of Error
    });

    it('should return the single item for an array with one element', () => {
        const singleItemArray = ['only one'];
        expect(pickRandomItem(singleItemArray)).toBe('only one');
    });

    it('should return an item that is present in the array', () => {
        const numbers = [1, 2, 3, 4, 5];
        const randomItem = pickRandomItem(numbers);
        expect(numbers).toContain(randomItem); // Checks if the returned item is one of the original items
    });

    it('should return an item of the correct type', () => {
        const strings = ['a', 'b', 'c'];
        const randomString = pickRandomItem(strings);
        expect(typeof randomString).toBe('string');

        const booleans = [true, false];
        const randomBoolean = pickRandomItem(booleans);
        expect(typeof randomBoolean).toBe('boolean');
    });

    it('should return different items over multiple calls (probabilistic)', () => {
        const largeArray = Array.from({ length: 100 }, (_, i) => i); // Array from 0 to 99
        const results = new Set<number>(); // Use a Set to store unique results

        // Call the function many times
        for (let i = 0; i < 50; i++) {
            // 50 calls should be enough to get varied results
            const item = pickRandomItem(largeArray);
            // No need to check for undefined here, as it now throws for empty array
            results.add(item);
        }

        // Expect to see more than one unique item (highly likely if random is working)
        expect(results.size).toBeGreaterThan(1);
    });

    it('should use Math.random()', () => {
        // Spy on Math.random
        const mathRandomSpy = jest.spyOn(Math, 'random');

        const array = [1, 2, 3];
        pickRandomItem(array);

        // Expect Math.random to have been called at least once
        expect(mathRandomSpy).toHaveBeenCalled();

        // Restore the original Math.random function after the test
        mathRandomSpy.mockRestore();
    });

    it('should pick the first item if Math.random() returns 0', () => {
        // Mock Math.random to always return 0
        const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

        const array = ['first', 'second', 'third'];
        const result = pickRandomItem(array);

        expect(result).toBe('first');
        expect(mathRandomSpy).toHaveBeenCalledTimes(1);

        mathRandomSpy.mockRestore(); // Restore original Math.random
    });

    it('should pick the last item if Math.random() returns close to 1', () => {
        // Mock Math.random to always return a value just under 1 (e.g., 0.99999)
        const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9999999999);

        const array = ['a', 'b', 'c']; // Length 3
        const result = pickRandomItem(array); // Math.floor(0.99999... * 3) = Math.floor(2.999...) = 2

        expect(result).toBe('c'); // Should pick the item at index 2
        expect(mathRandomSpy).toHaveBeenCalledTimes(1);

        mathRandomSpy.mockRestore();
    });
});

describe('shuffle', () => {
    // Store the original Math.random to restore it after tests
    const originalMathRandom = Math.random;

    afterEach(() => {
        Math.random = originalMathRandom;
        jest.restoreAllMocks(); // Restore any other mocks if used
    });

    it('should return an empty array when given an empty array', () => {
        const emptyArray: never[] = [];
        expect(shuffle(emptyArray)).toEqual([]);
    });

    it('should return the same array for a single-element array', () => {
        const singleItemArray = [42];
        expect(shuffle(singleItemArray)).toEqual([42]);
    });

    it('should not modify the original array (immutability)', () => {
        const originalArray = [1, 2, 3, 4, 5];
        const arrayCopy = [...originalArray]; // Create a copy to compare against
        shuffle(originalArray);
        expect(originalArray).toEqual(arrayCopy); // Original array should remain unchanged
    });

    it('should contain all original elements after shuffling', () => {
        const originalArray = [1, 2, 3, 4, 5];
        const shuffledArray = shuffle(originalArray);
        expect(shuffledArray.sort()).toEqual(originalArray.sort()); // Sort both to compare content
    });

    it('should maintain the same length as the original array', () => {
        const originalArray = ['a', 'b', 'c', 'd'];
        const shuffledArray = shuffle(originalArray);
        expect(shuffledArray.length).toBe(originalArray.length);
    });

    // This test is probabilistic. It's theoretically possible (but extremely unlikely) to fail.
    it('should produce a different order with no seed (probabilistic)', () => {
        // Mock Math.random to return a sequence that is likely to cause a shuffle
        const mockRandomValues = [0.5, 0.1, 0.9, 0.3, 0.7]; // Values that will cause sorting
        let callCount = 0;
        Math.random = jest.fn(() => mockRandomValues[callCount++ % mockRandomValues.length]);

        const originalArray = [1, 2, 3, 4, 5];
        const shuffledArray = shuffle(originalArray);

        // It's highly probable the order will change.
        // If it's the same, the randomness isn't effective or the array is too small.
        expect(shuffledArray).not.toEqual(originalArray);
    });

    it('should produce a deterministic order with the same seed', () => {
        const originalArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const seed = 'test_seed_123';

        const shuffled1 = shuffle(originalArray, seed);
        const shuffled2 = shuffle(originalArray, seed); // Shuffle again with the same seed

        expect(shuffled1).toEqual(shuffled2); // They must be identical
        expect(shuffled1).not.toEqual(originalArray); // Should actually be shuffled
    });

    it('should produce a different order with a different seed', () => {
        const originalArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const seed1 = 'seed_A';
        const seed2 = 'seed_B';

        const shuffled1 = shuffle(originalArray, seed1);
        const shuffled2 = shuffle(originalArray, seed2);

        // It's highly probable they will be different orders
        expect(shuffled1).not.toEqual(shuffled2);
    });

    it('should call Math.random when no seed is provided', () => {
        const mathRandomSpy = jest.spyOn(Math, 'random');
        const array = [1, 2, 3];
        shuffle(array);
        expect(mathRandomSpy).toHaveBeenCalled();
        mathRandomSpy.mockRestore();
    });
});
