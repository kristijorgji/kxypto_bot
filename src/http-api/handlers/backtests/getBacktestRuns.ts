import { Response as ExpressResponse } from 'express';

import { db } from '@src/db/knex';
import { getBacktestRuns } from '@src/db/repositories/backtests';
import { Tables } from '@src/db/tables';
import { Backtest, BacktestRun } from '@src/db/types';
import fetchCursorPaginatedData from '@src/db/utils/fetchCursorPaginatedData';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { Pagination, paginationSchema } from '@src/http-api/validation/common';

export const getBacktestRunsRequestSchema = {
    query: paginationSchema,
} satisfies RequestSchemaObject;

export default async (req: InferReq<typeof getBacktestRunsRequestSchema>, res: ExpressResponse) => {
    const query: Pagination = req.validated.query;

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
