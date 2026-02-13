import { deepEqual } from '../utils/data/equals';

export function make<T>(nr: number, factory: () => T): T[] {
    return Array.from({ length: nr }, () => factory());
}

export function makeIndexed<T>(nr: number, factory: (index: number) => T): T[] {
    return Array.from({ length: nr }, (_, index) => factory(index));
}

export function makeUnique<T>(nr: number, factory: () => T, initialBatch: T[] | null = null): T[] {
    const batch = initialBatch || make(nr, factory);
    const equalMap: Record<number, number[]> = {};

    for (let i = 0; i < batch.length - 1; i++) {
        for (let j = 1; j < batch.length; j++) {
            if (i === j) {
                continue;
            }

            if (deepEqual(batch[i], batch[j])) {
                if (!equalMap[i]) {
                    equalMap[i] = [];
                }
                equalMap[i].push(j);
            }
        }
    }

    if (Object.keys(equalMap).length > 0) {
        for (const index in equalMap) {
            let tries = 0;
            for (const equalIndex of equalMap[index]) {
                do {
                    batch[equalIndex] = factory();
                    tries++;
                } while (tries < 100 && deepEqual(batch[index], batch[equalIndex]));
                if (tries >= 100) {
                    throw Error(`Cannot make ${nr} unique entries with provided factory ${factory}`);
                }
            }
        }

        // @ts-ignore
        if (makeUnique.c && makeUnique.c === 5) {
            throw Error(`Cannot make ${nr} unique entries with provided factory ${factory}`);
        }
        // @ts-ignore
        if (makeUnique.c === undefined) {
            // @ts-ignore
            makeUnique.c = 0;
        }
        // @ts-ignore
        makeUnique.c++;

        return makeUnique(nr, factory, batch);
    }

    // @ts-ignore
    makeUnique.c = 0;

    return batch;
}

/**
 * Returns source[key] if the key exists (even if set to undefined).
 * Otherwise, returns defaultValue. This preserves "intentional undefined"
 * passed by the user, which nullish coalescing (??) would overwrite.
 */
export const withDefault = <T, K extends keyof T, D>(source: T | undefined, key: K, defaultValue: D): T[K] | D => {
    if (!source) return defaultValue;

    // If the key exists in the object (even if it is undefined),
    // we return the value from the object.
    if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
    }

    return defaultValue;
};
