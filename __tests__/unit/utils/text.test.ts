import { trimEllip } from '../../../src/utils/text';

describe(trimEllip.name, () => {
    test('returns the original string if it is shorter than maxLength', () => {
        expect(trimEllip('Hello', 10)).toBe('Hello');
    });

    test('returns the original string if it is exactly maxLength', () => {
        expect(trimEllip('HelloWorld', 10)).toBe('HelloWorld');
    });

    test('trims and appends "..." if string is longer than maxLength', () => {
        expect(trimEllip('HelloWorldThisIsLong', 10)).toBe('HelloWo...');
    });

    test('handles very short maxLength properly', () => {
        expect(trimEllip('Hello', 4)).toBe('H...');
    });

    test('handles edge case where maxLength is exactly 3', () => {
        expect(trimEllip('Hello', 3)).toBe('H...');
    });

    test('handles an empty string', () => {
        expect(trimEllip('', 10)).toBe('');
    });

    test('handles maxLength smaller than 3 correctly', () => {
        expect(trimEllip('Hello', 2)).toBe('H...');
        expect(trimEllip('Hello', 1)).toBe('H...');
    });

    test('handles large maxLength values correctly', () => {
        expect(trimEllip('Short', 100)).toBe('Short');
    });
});
