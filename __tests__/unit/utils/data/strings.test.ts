import { trimAtMaxLength } from '../../../../src/utils/data/strings';

describe('trimAtMaxLength', () => {
    it('returns the original string when length is within maxLength', () => {
        expect(trimAtMaxLength('hello', 10)).toBe('hello');
        expect(trimAtMaxLength('', 5)).toBe('');
    });

    it('trims and adds ellipsis when string is too long', () => {
        expect(trimAtMaxLength('HelloWorld', 8)).toBe('Hello...');
        expect(trimAtMaxLength('123456789', 6)).toBe('123...');
    });

    it('handles exact length equal to maxLength', () => {
        expect(trimAtMaxLength('abcdef', 6)).toBe('abcdef');
    });

    it('handles very small maxLength (<= 3) by slicing without ellipsis', () => {
        expect(trimAtMaxLength('abcdef', 3)).toBe('abc');
        expect(trimAtMaxLength('abcdef', 2)).toBe('ab');
        expect(trimAtMaxLength('abcdef', 1)).toBe('a');
        expect(trimAtMaxLength('abcdef', 0)).toBe('');
    });

    it('handles long strings with maxLength of 4 (edge case: should add ellipsis)', () => {
        // maxLength = 4 → take (4 - 3 = 1 char) + '...'
        expect(trimAtMaxLength('abcdef', 4)).toBe('a...');
    });

    it('correctly handles non-ASCII characters (Unicode safety)', () => {
        expect(trimAtMaxLength('🔥🔥🔥🔥', 5)).toBe('🔥...');
        expect(trimAtMaxLength('こんにちは', 4)).toBe('こ...');
    });

    it('works with whitespace', () => {
        expect(trimAtMaxLength('   hello   ', 6)).toBe('   ...');
    });
});
