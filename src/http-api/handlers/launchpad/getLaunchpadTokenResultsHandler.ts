import { Response as ExpressResponse, Request } from 'express';
import { z } from 'zod';

import { LaunchpadTokenFullResult, getLaunchpadTokenFullResult } from '@src/db/repositories/launchpad_tokens';
import CompositeCursor from '@src/db/utils/CompositeCursor';
import { CursorFactory } from '@src/db/utils/CursorFactory';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { exitMonitoringReasonEnum, modeEnum } from '@src/trading/bots/types';
import { formatDateToMySQLTimestamp } from '@src/utils/time';

const querySchema = z
    .object({
        mode: modeEnum.optional(),
        minSchemaVersion: z.coerce.number().optional(),
        tradesOnly: z.coerce.boolean().optional().default(false),
        exitCodes: z
            .string()
            .optional()
            .transform(val => val?.split(',').map(code => code.trim()) || [])
            .pipe(z.array(exitMonitoringReasonEnum)),
        excludeExitCodes: z
            .string()
            .optional()
            .transform(val => val?.split(',').map(code => code.trim()) || [])
            .pipe(z.array(exitMonitoringReasonEnum)),
        includeTrades: z.coerce.boolean().optional().default(false),
        limit: z.coerce
            .number()
            .int()
            .min(1, { message: 'Limit must be at least 1' })
            .max(1000, { message: 'Limit cannot exceed 1000' })
            .default(100),
        cursor: z.string().optional(),
    })
    .refine(
        data => {
            const includes = data.exitCodes || [];
            const excludes = data.excludeExitCodes || [];
            const overlap = includes.filter(code => excludes.includes(code));
            return overlap.length === 0;
        },
        {
            message: 'exitCodes and excludeExitCodes cannot contain overlapping values.',
            path: ['exitCodes'],
        },
    );
type QueryParams = z.infer<typeof querySchema>;

export default async (req: Request, res: ExpressResponse) => {
    let query: QueryParams;
    try {
        query = querySchema.parse(req.query);
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({
                message: 'Query params validation failed',
                errors: error.errors.map(err => ({
                    path: err.path.join('.'),
                    message: err.message,
                })),
            });
        }

        throw error;
    }

    const direction: 'asc' | 'desc' = 'desc';

    let decodedCursor: CompositeCursor | undefined;
    if (query.cursor) {
        decodedCursor = CursorFactory.decodeCursor(query.cursor);
    }

    const data = await getLaunchpadTokenFullResult<HandlePumpTokenReport>({
        mode: query.mode,
        chain: 'solana',
        platform: 'pumpfun',
        minSchemaVersion: query.minSchemaVersion,
        tradesOnly: query.tradesOnly,
        exitCodes: query.exitCodes,
        excludeExitCodes: query.excludeExitCodes,
        includeTrades: query.includeTrades,
        direction: direction,
        limit: query.limit + 1,
        cursor: decodedCursor,
    });

    let nextCursor: string | null = null;
    if (data.length > query.limit) {
        const lastItem = data[query.limit - 1];
        nextCursor = CursorFactory.formCursor({
            lastPreviousId: lastItem.id.toString(),
            lastDate: formatDateToMySQLTimestamp(lastItem.created_at, true),
        });
        data.pop();
    }

    res.json({
        data: data,
        count: data.length,
        nextCursor: nextCursor,
    } satisfies CursorPaginatedResponse<LaunchpadTokenFullResult<HandlePumpTokenReport>>);
};
