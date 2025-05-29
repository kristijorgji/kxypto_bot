import { deepEqual } from '../utils/data/equals';

export function make<T>(nr: number, factory: () => T): T[] {
    return Array(nr)
        .fill(0)
        .map(() => factory());
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
