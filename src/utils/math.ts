export function calculateMedian(arr: number[]): number {
    if (arr.length === 0) {
        throw new Error('The provided array is empty');
    }

    const sortedArr = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedArr.length / 2);

    return sortedArr.length % 2 !== 0 ? sortedArr[mid] : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

/**
 * Calculates the weighted average of a list of values.
 *
 * @param values The array of numbers to average.
 * @param weights The array of corresponding weights.
 * @returns The weighted average, or 0 if the total weight is 0.
 * @throws Error if the lengths of the values and weights arrays are not equal.
 */
export function calculateWeightedAverage(values: number[], weights: number[]): number {
    if (values.length !== weights.length) {
        throw new Error('The arrays of values and weights must have the same length.');
    }

    if (values.length === 0) {
        return 0;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < values.length; i++) {
        weightedSum += values[i] * weights[i];
        totalWeight += weights[i];
    }

    // Handle the case where the sum of weights is zero to avoid division by zero
    if (totalWeight === 0) {
        return 0;
    }

    return weightedSum / totalWeight;
}
