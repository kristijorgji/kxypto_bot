import { RangeNumericValue, isRangeNumericValue } from '@src/types/data';

/**
 * Helper to generate numeric steps safely, handling floating point precision.
 */
function getRangeValues(range: RangeNumericValue): number[] {
    const values: number[] = [];
    const precision = 10;
    const epsilon = range.step / 1000;

    for (let val = range.from; val <= range.to + epsilon; val += range.step) {
        values.push(parseFloat(val.toFixed(precision)));
    }
    return values;
}

/**
 * GENERATOR: Yields one strictly numeric configuration at a time.
 * Memory-efficient: only one full config exists in memory per yield.
 */
export function* generatePermutationsGenerator<T>(input: unknown, validator: (data: unknown) => T): Generator<T> {
    const paths: { path: string[]; values: number[] }[] = [];

    function findRanges(obj: unknown, currentPath: string[] = []) {
        if (!obj || typeof obj !== 'object') return;

        if (isRangeNumericValue(obj)) {
            paths.push({ path: currentPath, values: getRangeValues(obj as RangeNumericValue) });
            return;
        }

        for (const [key, value] of Object.entries(obj)) {
            findRanges(value, [...currentPath, key]);
        }
    }

    findRanges(input);

    if (paths.length === 0) {
        yield validator(input);
        return;
    }

    function* combine(currentConfig: unknown, pathIdx: number): Generator<T> {
        if (pathIdx === paths.length) {
            yield validator(currentConfig);
            return;
        }

        const { path, values } = paths[pathIdx];

        for (const val of values) {
            // Clone the config for this specific branch
            const nextConfig = JSON.parse(JSON.stringify(currentConfig));

            let target = nextConfig;
            for (let i = 0; i < path.length - 1; i++) {
                target = target[path[i]];
            }
            target[path[path.length - 1]] = val;

            yield* combine(nextConfig, pathIdx + 1);
        }
    }

    yield* combine(input, 0);
}

/**
 * ARRAY: Returns all permutations at once.
 * Note: Use countPermutations() first to ensure this won't crash your memory.
 */
export function generatePermutationsArray<T>(input: unknown, validator: (data: unknown) => T): T[] {
    return Array.from(generatePermutationsGenerator<T>(input, validator));
}
