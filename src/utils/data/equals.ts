// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepEqual(obj1: any, obj2: any, ignoreKeys?: Set<string>): boolean {
    if (obj1 === undefined && obj2 === undefined) {
        return true;
    } else if (obj1 === null && obj2 === null) {
        return true;
    } else if ((obj1 === null && obj2 !== null) || (obj1 !== null && obj2 === null)) {
        return false;
    } else if (isPrimitive(obj1) && isPrimitive(obj2)) {
        return obj1 === obj2;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
        return false;
    }

    for (const key of keys1) {
        if (ignoreKeys?.has(key)) {
            continue;
        }

        const val1 = obj1[key];
        const val2 = obj2[key];
        const areObjects = isObject(val1) && isObject(val2);
        if ((areObjects && !deepEqual(val1, val2)) || (!areObjects && val1 !== val2)) {
            return false;
        }
    }

    return true;
}

export function isObject(source: unknown): boolean {
    return source != null && typeof source === 'object';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPrimitive(test: any): boolean {
    return test !== Object(test);
}
