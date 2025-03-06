/* eslint-disable @typescript-eslint/no-explicit-any */

export function insertKeysAfter<T extends Record<string, any>, O extends Record<string, any>>(
    obj: T,
    insertions: Record<string, Record<string, any>>,
): O {
    const newObj: Record<string, any> = {};

    for (const key in obj) {
        newObj[key] = obj[key];

        if (key in insertions) {
            Object.assign(newObj, insertions[key]);
        }
    }

    return newObj as O;
}
