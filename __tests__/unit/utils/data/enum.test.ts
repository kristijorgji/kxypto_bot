import { getRandomEnumValue, mapStringToEnum } from '../../../../src/utils/data/enum';

describe('getRandomEnumValue', () => {
    enum StringEnum {
        One = 'one',
        Two = 'two',
        Three = 'three',
    }

    enum MixedEnum {
        X = 'x',
        Y = 5,
        Z = 'z',
    }

    test('returns a valid value from a string enum', () => {
        const result = getRandomEnumValue(StringEnum);
        expect(Object.values(StringEnum)).toContain(result);
    });

    test('returns a valid value from a mixed enum', () => {
        const result = getRandomEnumValue(MixedEnum);
        const values = Object.values(MixedEnum);
        expect(values).toContain(result);
    });

    test('never returns undefined', () => {
        for (let i = 0; i < 200; i++) {
            const r = getRandomEnumValue(StringEnum);
            expect(r).toBeDefined();
        }
    });

    test('randomness sanity check: values vary', () => {
        const results = new Set<string>();
        for (let i = 0; i < 100; i++) {
            results.add(getRandomEnumValue(StringEnum));
        }
        // Expect at least 2 different values out of 3
        expect(results.size).toBeGreaterThan(1);
    });

    test('types: return type is EnumValue not string', () => {
        const r: StringEnum = getRandomEnumValue(StringEnum);
        expect(Object.values(StringEnum)).toContain(r);
    });
});

enum TestStatus {
    Pending = 'pending',
    Running = 'running',
    Done = 'done',
}

describe('mapStringToEnum', () => {
    test('maps exact match', () => {
        expect(mapStringToEnum('pending', TestStatus)).toBe(TestStatus.Pending);
    });

    test('maps uppercase input', () => {
        expect(mapStringToEnum('RUNNING', TestStatus)).toBe(TestStatus.Running);
    });

    test('maps mixed-case input', () => {
        expect(mapStringToEnum('DoNe', TestStatus)).toBe(TestStatus.Done);
    });

    test('throws error for unknown value', () => {
        expect(() => mapStringToEnum('invalid', TestStatus)).toThrow('Unknown enum value: invalid');
    });

    test('throws error for empty string', () => {
        expect(() => mapStringToEnum('', TestStatus)).toThrow('Unknown enum value: ');
    });

    test('throws error for value that exists in different enum', () => {
        expect(() => mapStringToEnum('yes', TestStatus)).toThrow();
    });
});
