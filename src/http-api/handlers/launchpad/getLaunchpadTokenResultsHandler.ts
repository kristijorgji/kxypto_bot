import { Response as ExpressResponse } from 'express';
import { z } from 'zod';

import { LaunchpadTokenFullResult, getLaunchpadTokenFullResult } from '@src/db/repositories/launchpad_tokens';
import { blockchainEnum, launchpadPlatformEnum } from '@src/db/types';
import CompositeCursor from '@src/db/utils/CompositeCursor';
import { CursorFactory } from '@src/db/utils/CursorFactory';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { paginationSchema } from '@src/http-api/validation/common';
import { HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { exitMonitoringReasonEnum, modeEnum } from '@src/trading/bots/types';
import { formatDateToMySQLTimestamp } from '@src/utils/time';

const querySchema = z
    .object({
        mode: modeEnum.optional(),
        chain: blockchainEnum.optional(),
        platform: launchpadPlatformEnum.optional(),
        minSchemaVersion: z.coerce.number().optional(),
        mint: z.string().optional(),
        tradesOnly: z.coerce.boolean().optional().default(false),
        tradeOutcome: z.enum(['win', 'loss']).optional(),
        strategyId: z.string().optional(),
        strategyName: z.string().optional(),
        strategyConfigVariant: z.string().optional(),
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
    })
    .extend(paginationSchema.shape)
    .superRefine((data, ctx) => {
        const includesExitCodes = data.exitCodes || [];
        const excludesExitCodes = data.excludeExitCodes || [];
        const exitCodesOverlap = includesExitCodes.filter(code => excludesExitCodes.includes(code));

        if (exitCodesOverlap.length !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `exitCodes and excludeExitCodes cannot contain overlapping values. [${excludesExitCodes.join(',')}]`,
                path: ['exitCodes'],
            });
        }

        const isUsingExitCodes = includesExitCodes.length > 0 || excludesExitCodes.length > 0;

        if (isUsingExitCodes && data.tradesOnly) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'You must choose a single filtering method. Please use either exit codes (including exitCodes and excludeExitCodes) OR the tradesOnly filter)',
                path: ['exitCodes'],
            });
        }

        if (isUsingExitCodes && data.tradeOutcome) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'You must choose a single filtering method. Please use either exit codes (including exitCodes and excludeExitCodes) OR the tradeOutcome filter',
                path: ['exitCodes'],
            });
        }
    })
    .transform(data => {
        if (data.tradeOutcome && !data.tradesOnly) {
            return {
                ...data,
                tradesOnly: true,
            };
        }

        return data;
    });

export const getLaunchpadTokenResultsRequestSchema = {
    query: querySchema,
} satisfies RequestSchemaObject;

export default async (req: InferReq<typeof getLaunchpadTokenResultsRequestSchema>, res: ExpressResponse) => {
    const query = req.validated.query;
    const direction: 'asc' | 'desc' = 'desc';

    let decodedCursor: CompositeCursor | undefined;
    if (query.cursor) {
        decodedCursor = CursorFactory.decodeCursor(query.cursor);
    }

    const data = await getLaunchpadTokenFullResult<HandlePumpTokenReport>({
        mode: query.mode,
        chain: query.chain,
        platform: query.platform,
        minSchemaVersion: query.minSchemaVersion,
        mint: query.mint,
        strategyId: query.strategyId,
        strategyName: query.strategyName,
        strategyConfigVariant: query.strategyConfigVariant,
        tradesOnly: query.tradesOnly,
        tradeOutcome: query.tradeOutcome,
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
