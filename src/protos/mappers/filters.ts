import { ProtoFilterValue } from '@src/protos/generated/ws';
import { PlainFilters } from '@src/types/data';

/**
 * Pack plain filters into protobuf map<string, ProtoFilterValue>
 */
export function packFilters(filters: PlainFilters): Record<string, ProtoFilterValue> {
    const packed: Record<string, ProtoFilterValue> = {};

    for (const [key, value] of Object.entries(filters)) {
        const fv: ProtoFilterValue = {};

        if (Array.isArray(value)) {
            const strings: string[] = [];
            const numbers: number[] = [];
            const bools: boolean[] = [];

            for (const v of value) {
                if (typeof v === 'string') strings.push(v);
                else if (typeof v === 'number') numbers.push(v);
                else if (typeof v === 'boolean') bools.push(v);
            }

            if (strings.length) fv.string_array = { values: strings };
            if (numbers.length) fv.number_array = { values: numbers };
            if (bools.length) fv.bool_array = { values: bools };
        } else {
            // single_value (oneof)
            if (typeof value === 'string') fv.string_value = value;
            else if (typeof value === 'number') fv.number_value = value;
            else if (typeof value === 'boolean') fv.bool_value = value;
        }

        packed[key] = fv;
    }

    return packed;
}

/**
 * Unpack protobuf map<string, ProtoFilterValue> back to plain JS object
 * Preserves mixed arrays and single values correctly.
 */
export function unpackFilters(packed: Record<string, ProtoFilterValue>): PlainFilters {
    const filters: PlainFilters = {};

    for (const [key, fv] of Object.entries(packed)) {
        const values: Array<string | number | boolean> = [];

        // Single values
        if (fv.string_value !== undefined) values.push(fv.string_value);
        if (fv.number_value !== undefined) values.push(fv.number_value);
        if (fv.bool_value !== undefined) values.push(fv.bool_value);

        // Arrays
        if (fv.string_array?.values) values.push(...fv.string_array.values);
        if (fv.number_array?.values) values.push(...fv.number_array.values);
        if (fv.bool_array?.values) values.push(...fv.bool_array.values);

        // Only include in output if there is at least one value
        if (values.length === 0) continue;

        // If array has only one element, and it was originally single, return single
        filters[key] = values.length === 1 ? values[0] : values;
    }

    return filters;
}
