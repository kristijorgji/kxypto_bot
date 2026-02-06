import { z } from 'zod';

import { rangeNumericValueSchema } from '@src/types/data';

/**
 * Recursively transforms a schema:
 * every ZodNumber becomes ZodNumber | rangeNumericValueSchema
 */
export function upgradeToRangeAware(schema: z.ZodTypeAny): z.ZodTypeAny {
    // 1. Core: Transform Numbers
    if (schema instanceof z.ZodNumber) {
        return z.union([schema, rangeNumericValueSchema]);
    }

    // 2. Objects: Transform all properties in the shape
    if (schema instanceof z.ZodObject) {
        const newShape = Object.fromEntries(
            Object.entries(schema.shape).map(([key, value]) => [key, upgradeToRangeAware(value as z.ZodTypeAny)]),
        );
        return z.object(newShape);
    }

    // 3. Arrays: Transform the element type
    if (schema instanceof z.ZodArray) {
        return z.array(upgradeToRangeAware(schema.element));
    }

    // 4. Intersections (.and()): Transform both left and right sides
    if (schema instanceof z.ZodIntersection) {
        return z.intersection(upgradeToRangeAware(schema._def.left), upgradeToRangeAware(schema._def.right));
    }

    // 5. Unions & Discriminated Unions: Transform every possible option
    if (schema instanceof z.ZodUnion) {
        return z.union(schema.options.map((opt: z.ZodTypeAny) => upgradeToRangeAware(opt)));
    }

    if (schema instanceof z.ZodDiscriminatedUnion) {
        return z.discriminatedUnion(
            schema.discriminator,
            schema.options.map((opt: z.ZodTypeAny) => upgradeToRangeAware(opt)),
        );
    }

    // 6. Wrappers: Optional, Nullable, Default, Effects (Refinements)
    if (schema instanceof z.ZodOptional) {
        return upgradeToRangeAware(schema.unwrap()).optional();
    }
    if (schema instanceof z.ZodNullable) {
        return upgradeToRangeAware(schema.unwrap()).nullable();
    }
    if (schema instanceof z.ZodDefault) {
        return upgradeToRangeAware(schema._def.innerType).default(schema._def.defaultValue());
    }

    // 7. Effects (Refinements/Transforms)
    if (schema instanceof z.ZodEffects) {
        const inputSchema = upgradeToRangeAware(schema._def.schema);
        const effect = schema._def.effect;

        if (effect.type === 'refinement') {
            return inputSchema.superRefine((val, ctx) => {
                // 1. Bypass refinement if it's a range object
                if (val && typeof val === 'object' && val.type === 'range') {
                    return;
                }

                // 2. Run original refinement.
                // Note: superRefine is used here because it's the most
                // robust way to pass the full context manually.
                return effect.refinement(val, ctx);
            });
        }

        if (effect.type === 'transform') {
            return inputSchema.transform((val, ctx) => {
                if (val && typeof val === 'object' && val.type === 'range') {
                    return val;
                }
                return effect.transform(val, ctx);
            });
        }

        return inputSchema;
    }

    return schema;
}
