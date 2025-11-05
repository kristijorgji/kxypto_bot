import { Response as ExpressResponse, Request } from 'express';
import { z } from 'zod';

import { db } from '@src/db/knex';
import { getBacktestRuns } from '@src/db/repositories/backtests';
import { Tables } from '@src/db/tables';
import { Backtest, BacktestRun } from '@src/db/types';
import fetchCursorPaginatedData from '@src/db/utils/fetchCursorPaginatedData';
import { CursorPaginatedResponse } from '@src/http-api/types';

const querySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1, { message: 'Limit must be at least 1' })
        .max(1000, { message: 'Limit cannot exceed 1000' })
        .default(100),
    cursor: z.string().optional(),
});
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
            return;
        }

        throw error;
    }

    const paginatedData = await fetchCursorPaginatedData(
        getBacktestRuns,
        {
            cursor: query.cursor,
            limit: query.limit,
            direction: 'desc',
        },
        {},
    );

    const backtestIds = [...new Set(paginatedData.data.map(r => r.backtest_id))];
    const backtests = await db(Tables.Backtests).whereIn('id', backtestIds).select('*');

    const userIds = [...new Set(paginatedData.data.map(r => r.user_id).filter(id => id !== null))];
    const users = await db(Tables.Users).whereIn('id', userIds).select(['id', 'name', 'username']);

    res.json({
        runs: paginatedData,
        backtests: Object.fromEntries(backtests.map(b => [b.id, b])),
        users: Object.fromEntries(users.map(u => [u.id, u])),
    } satisfies {
        runs: CursorPaginatedResponse<BacktestRun>;
        backtests: Record<string, Backtest>;
        users: Record<
            string,
            {
                id: string;
                name: string;
                username: string;
            }
        >;
    });
};
