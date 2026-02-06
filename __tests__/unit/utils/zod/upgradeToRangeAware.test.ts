import { z } from 'zod';

import { upgradeToRangeAware } from '../../../../src/utils/zod/upgradeToRangeAware';

describe('upgradeToRangeAware', () => {
    it('should upgrade a simple numeric field', () => {
        const schema = z.object({
            age: z.number(),
            name: z.string(),
        });

        const upgraded = upgradeToRangeAware(schema) as z.ZodObject<never>;

        // Should accept a number
        expect(upgraded.parse({ age: 25, name: 'John' })).toEqual({ age: 25, name: 'John' });

        // Should accept a range object
        const rangeInput = {
            age: { type: 'range', from: 18, to: 65, step: 1 },
            name: 'John',
        };
        expect(upgraded.parse(rangeInput)).toEqual(rangeInput);
    });

    it('should recurse through nested objects and arrays', () => {
        const schema = z.object({
            settings: z.array(
                z.object({
                    value: z.number(),
                }),
            ),
        });

        const upgraded = upgradeToRangeAware(schema) as z.ZodObject<never>;
        const input = {
            settings: [{ value: 10 }, { value: { type: 'range', from: 0, to: 100, step: 10 } }],
        };

        expect(() => upgraded.parse(input)).not.toThrow();
    });

    it('should handle ZodIntersection (.and)', () => {
        const schema = z.object({ a: z.number() }).and(z.object({ b: z.number() }));
        const upgraded = upgradeToRangeAware(schema);

        const input = {
            a: { type: 'range', from: 1, to: 5, step: 1 },
            b: 10,
        };

        expect(upgraded.parse(input)).toEqual(input);
    });

    it('should handle ZodDiscriminatedUnion', () => {
        const schema = z.discriminatedUnion('type', [
            z.object({ type: z.literal('A'), val: z.number() }),
            z.object({ type: z.literal('B'), val: z.string() }),
        ]);

        const upgraded = upgradeToRangeAware(schema);

        const input = { type: 'A', val: { type: 'range', from: 1, to: 10, step: 1 } };
        expect(upgraded.parse(input)).toEqual(input);

        // Ensure string remains string in the other union branch
        expect(() => upgraded.parse({ type: 'B', val: 123 })).toThrow();
    });

    it('should handle ZodOptional and ZodNullable', () => {
        const schema = z.object({
            maybeNum: z.number().optional(),
            nullNum: z.number().nullable(),
        });

        const upgraded = upgradeToRangeAware(schema) as z.ZodObject<never>;

        expect(upgraded.parse({ maybeNum: undefined, nullNum: null })).toEqual({ maybeNum: undefined, nullNum: null });
        expect(
            upgraded.parse({
                maybeNum: { type: 'range', from: 1, to: 2, step: 1 },
                nullNum: { type: 'range', from: 5, to: 10, step: 0.5 },
            }),
        ).toBeDefined();
    });

    it('should preserve effects for numbers but bypass them for ranges', () => {
        // Original schema has a refinement
        const schema = z.number().refine(n => n > 10, 'Must be > 10');
        const upgraded = upgradeToRangeAware(schema);

        // 1. Refinement should STILL fail for regular numbers
        const failResult = upgraded.safeParse(5);
        expect(failResult.success).toBe(false);
        if (!failResult.success) {
            expect(failResult.error.issues[0].message).toBe('Must be > 10');
        }

        // 2. Refinement should pass for valid numbers
        expect(upgraded.safeParse(15).success).toBe(true);

        // 3. Refinement should be BYPASSED for range objects
        const rangeInput = { type: 'range', from: 1, to: 5, step: 1 };
        expect(upgraded.safeParse(rangeInput).success).toBe(true);
    });

    it('should handle nested refinements correctly', () => {
        const schema = z
            .number()
            .refine(n => n > 0, { message: 'Must be positive' })
            .refine(n => n % 2 === 0, { message: 'Must be even' });

        const upgraded = upgradeToRangeAware(schema);

        // Should fail specific checks
        expect(upgraded.safeParse(-2).success).toBe(false); // Fails positive
        expect(upgraded.safeParse(3).success).toBe(false); // Fails even

        // Should pass valid
        expect(upgraded.safeParse(4).success).toBe(true);

        // Should bypass both for range
        const rangeInput = { type: 'range', from: 1, to: 10, step: 1 };
        expect(upgraded.safeParse(rangeInput).success).toBe(true);
    });
});
