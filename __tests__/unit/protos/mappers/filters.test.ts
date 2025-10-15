import { packFilters, unpackFilters } from '@src/protos/mappers/filters';
import { PlainFilters } from '@src/types/data';

describe('Filters packing/unpacking', () => {
    it('should pack and unpack string value', () => {
        const input: PlainFilters = { name: 'Alice' };
        const packed = packFilters(input);
        expect(packed.name.string_value).toBe('Alice');

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual(input);
    });

    it('should pack and unpack number value', () => {
        const input: PlainFilters = { age: 30 };
        const packed = packFilters(input);
        expect(packed.age.number_value).toBe(30);

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual(input);
    });

    it('should pack and unpack boolean value', () => {
        const input: PlainFilters = { active: true };
        const packed = packFilters(input);
        expect(packed.active.bool_value).toBe(true);

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual(input);
    });

    it('should pack and unpack string array', () => {
        const input: PlainFilters = { tags: ['foo', 'bar'] };
        const packed = packFilters(input);
        expect(packed.tags.string_array?.values).toEqual(['foo', 'bar']);

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual(input);
    });

    it('should pack and unpack mixed type array', () => {
        const input: PlainFilters = { mixed: ['a', 1, true] };
        const packed = packFilters(input);
        expect(packed.mixed.string_array?.values).toEqual(['a']);
        expect(packed.mixed.number_array?.values).toEqual([1]);
        expect(packed.mixed.bool_array?.values).toEqual([true]);

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual(input);
    });

    it('should handle empty object', () => {
        const input: PlainFilters = {};
        const packed = packFilters(input);
        expect(packed).toEqual({});

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual({});
    });

    it('should ignore undefined values', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input: PlainFilters = { skip: undefined as any };
        const packed = packFilters(input);
        expect(packed.skip).toEqual({});

        const unpacked = unpackFilters(packed);
        expect(unpacked).toEqual({});
    });
});
