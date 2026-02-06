import { z } from 'zod';

type PlainFilterValue = string | number | boolean | undefined;

export interface PlainFilters extends Record<string, PlainFilterValue | Array<PlainFilterValue>> {}

export type Pagination = {
    /**
     * Pagination direction by date: ascending (oldest first) or descending (newest first).
     */
    direction?: 'asc' | 'desc';

    /**
     * Maximum number of items to return in this page.
     */
    limit: number;

    /**
     * Cursor for the last item received.
     * Can be a string (often base64-encoded) representing a composite cursor
     * that encodes multiple pieces of information to continue pagination.
     * Optional: omit for the first page of results.
     */
    cursor?: string;
};

export const rangeNumericValueSchema = z
    .object({
        type: z.literal('range'),
        from: z.number(),
        to: z.number(),
        step: z.number().positive(),
    })
    .refine(data => data.to > data.from, {
        // eslint-disable-next-line quotes
        message: "The 'to' value must be greater than 'from'",
        path: ['to'], // This puts the error on the 'to' field specifically
        params: { code: 'range_to_gte_from' },
    })
    .refine(data => data.step <= data.to - data.from, {
        message: 'Step size is too large for this range',
        path: ['step'],
        params: { code: 'range_step_too_large' },
    });

export type RangeNumericValue = z.infer<typeof rangeNumericValueSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRangeNumericValue = (val: any): val is RangeNumericValue => {
    return (
        val &&
        typeof val === 'object' &&
        val.type === 'range' &&
        typeof val.from === 'number' &&
        typeof val.to === 'number' &&
        typeof val.step === 'number'
    );
};
