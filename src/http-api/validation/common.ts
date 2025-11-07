import { z } from 'zod';

export const paginationSchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1, { message: 'Limit must be at least 1' })
        .max(1000, { message: 'Limit cannot exceed 1000' })
        .default(100),
    cursor: z.string().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;
