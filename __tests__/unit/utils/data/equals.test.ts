import { deepEqual } from '../../../../src/utils/data/equals';

describe(deepEqual.name, () => {
    test('returns true for identical primitive values', () => {
        expect(deepEqual(5, 5)).toBe(true);
        expect(deepEqual('hello', 'hello')).toBe(true);
        expect(deepEqual(null, null)).toBe(true);
        expect(deepEqual(undefined, undefined)).toBe(true);
        expect(deepEqual(true, true)).toBe(true);
    });

    test('returns false for different primitive values', () => {
        expect(deepEqual(5, 10)).toBe(false);
        expect(deepEqual('hello', 'world')).toBe(false);
        expect(deepEqual(true, false)).toBe(false);
        expect(deepEqual(null, undefined)).toBe(false);
    });

    test('returns true for identical objects', () => {
        const obj1 = { a: 1, b: 'test', c: true, d: { e: { m: 'ddd' } } };
        const obj2 = { a: 1, b: 'test', c: true, d: { e: { m: 'ddd' } } };
        expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test('returns false for objects with different values', () => {
        const obj1 = { a: 1, b: 'test', c: true, d: { a: 'fff' } };
        const obj2 = { a: 2, b: 'test', c: true };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });

    test('returns false for objects with different keys', () => {
        const obj1 = { a: 1, b: 'test' };
        const obj2 = { a: 1, b: 'test', c: true };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });

    test('returns true for deeply nested identical objects', () => {
        const obj1 = { a: 1, b: { c: 2, d: { e: 3 } } };
        const obj2 = { a: 1, b: { c: 2, d: { e: 3 } } };
        expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test('returns false for deeply nested objects with different values', () => {
        const obj1 = { a: 1, b: { c: 2, d: { e: 3 } } };
        const obj2 = { a: 1, b: { c: 2, d: { e: 4 } } };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });

    test('returns true when ignoring specific keys', () => {
        const obj1 = { a: 1, b: 'test', c: 3 };
        const obj2 = { a: 1, b: 'test', c: 999 };
        expect(deepEqual(obj1, obj2, new Set(['c']))).toBe(true);
    });

    test('returns false when ignoring a key that is not present in both objects', () => {
        const obj1 = { a: 1, b: 'test' };
        const obj2 = { a: 1, b: 'test', c: 999 };
        expect(deepEqual(obj1, obj2, new Set(['c']))).toBe(false);
    });

    test('returns false for different types', () => {
        expect(deepEqual({ a: 1 }, [1])).toBe(false);
        expect(deepEqual('test', { value: 'test' })).toBe(false);
    });

    test('handles empty objects correctly', () => {
        expect(deepEqual({}, {})).toBe(true);
        expect(deepEqual({ a: 1 }, {})).toBe(false);
        expect(deepEqual({}, { a: 1 })).toBe(false);
    });

    test('returns false for different arrays', () => {
        expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
        expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
    });

    test('handles objects containing arrays', () => {
        const obj1 = { a: [1, 2, 3], b: { c: 4 } };
        const obj2 = { a: [1, 2, 3], b: { c: 4 } };
        expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test('returns false for objects with different array values', () => {
        const obj1 = { a: [1, 2, 3] };
        const obj2 = { a: [1, 2, 4] };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });
});
