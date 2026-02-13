import { withDefault } from '../../../src/testdata/utils';

describe('withDefault', () => {
    interface TestData {
        id?: string;
        name?: string;
        count?: number;
    }

    it('returns the default value when the source object is undefined', () => {
        const result = withDefault(undefined as TestData | undefined, 'id', 'default-id');
        expect(result).toBe('default-id');
    });

    it('returns the default value when the key is completely missing', () => {
        const source: TestData = { name: 'John' };
        const result = withDefault(source, 'id', 'default-id');
        expect(result).toBe('default-id');
    });

    it('returns the existing value when the key is provided with a value', () => {
        const source: TestData = { id: 'real-id' };
        const result = withDefault(source, 'id', 'default-id');
        expect(result).toBe('real-id');
    });

    it('preserves intentional undefined when passed by the user', () => {
        // This is the core requirement
        const source: TestData = { id: undefined };

        const result = withDefault(source, 'id', 'default-id');

        // Should NOT be 'default-id' because the key exists
        expect(result).toBeUndefined();
        expect(source).toHaveProperty('id');
    });

    it('works correctly with falsy values (0, empty string, false)', () => {
        const source: TestData = { count: 0 };

        const result = withDefault(source, 'count', 100);

        // Should be 0, not 100
        expect(result).toBe(0);
    });

    it('works with objects created via Object.create(null)', () => {
        // These objects don't have hasOwnProperty on their prototype
        const source = Object.create(null);
        source.id = undefined;

        const result = withDefault(source, 'id', 'default-id');
        expect(result).toBeUndefined();
    });
});
