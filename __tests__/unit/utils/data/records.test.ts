import { insertKeysAfter } from '../../../../src/utils/data/records';

describe(insertKeysAfter.name, () => {
    test('should insert a single key-value pair after the specified key', () => {
        const originalObj = { a: 1, b: 2, c: 3 };
        const insertions = { b: { newKey: 99 } };

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({ a: 1, b: 2, newKey: 99, c: 3 });
    });

    test('should insert multiple key-value pairs after the specified key', () => {
        const originalObj = { a: 1, b: 2, c: 3 };
        const insertions = { b: { newKey1: 99, newKey2: 100 } };

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({ a: 1, b: 2, newKey1: 99, newKey2: 100, c: 3 });
    });

    test('should insert keys after multiple specified keys', () => {
        const originalObj = { a: 1, b: 2, c: 3 };
        const insertions = { a: { afterA: 'A' }, b: { afterB1: 'B1', afterB2: 'B2' } };

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({ a: 1, afterA: 'A', b: 2, afterB1: 'B1', afterB2: 'B2', c: 3 });
    });

    test('should not modify the object if the insertion key does not exist', () => {
        const originalObj = { a: 1, b: 2, c: 3 };
        const insertions = { x: { newKey: 99 } }; // 'x' is not in originalObj

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({ a: 1, b: 2, c: 3 }); // No change
    });

    test('should work with an empty insertions object', () => {
        const originalObj = { a: 1, b: 2, c: 3 };
        const insertions = {}; // No insertions

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({ a: 1, b: 2, c: 3 }); // No change
    });

    test('should work with an empty original object', () => {
        const originalObj = {}; // Empty object
        const insertions = { a: { newKey: 99 } };

        const result = insertKeysAfter(originalObj, insertions);
        expect(result).toEqual({}); // Still empty since 'a' doesn't exist
    });

    test('should maintain the original order of keys', () => {
        const originalObj = { first: 1, second: 2, third: 3 };
        const insertions = { first: { afterFirst: 'X' }, third: { afterThird: 'Y' } };

        const result = insertKeysAfter(originalObj, insertions);
        expect(Object.keys(result)).toEqual(['first', 'afterFirst', 'second', 'third', 'afterThird']);
    });
});
