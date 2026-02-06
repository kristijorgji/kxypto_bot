import { isRangeNumericValue } from '@src/types/data';

/**
 * Calculates the total number of possible combinations in a configuration object
 * by multiplying the number of steps in every detected RangeNumericValue.
 * This is a fast O(N) operation that avoids memory-heavy object generation.
 */
export function countPermutations(input: unknown): number {
    let count = 1;
    let foundRange = false;

    function findAndCount(obj: unknown) {
        if (!obj || typeof obj !== 'object') return;

        if (isRangeNumericValue(obj)) {
            foundRange = true;
            // The +1 ensures the 'to' value is included in the count
            const steps = Math.floor((obj.to - obj.from) / obj.step) + 1;
            count *= Math.max(0, steps);
            return;
        }

        for (const value of Object.values(obj)) {
            findAndCount(value);
        }
    }

    findAndCount(input);

    // If no ranges were found, there is technically 1 permutation (the input itself)
    return foundRange ? count : 1;
}
