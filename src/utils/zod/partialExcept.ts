import { z } from 'zod';

export function partialExcept<T extends z.ZodRawShape, K extends keyof T>(
    schema: z.ZodObject<T>,
    requiredKeys: readonly K[],
) {
    const partial = schema.partial();

    // Build a shape that only contains the required keys,
    // reusing the original schema's definitions.
    const requiredShape = {} as Pick<T, K>;
    for (const key of requiredKeys) {
        requiredShape[key] = schema.shape[key];
    }

    return partial.extend(requiredShape);
}
