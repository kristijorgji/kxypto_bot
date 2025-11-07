import { Response as ExpressResponse } from 'express';
import { z } from 'zod';

import { getBacktestById } from '@src/db/repositories/backtests';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';

export const getBacktestRequestSchema = {
    urlParams: z.object({
        id: z.string().uuid(),
    }),
} satisfies RequestSchemaObject;

export async function getBacktestHandler(
    req: InferReq<typeof getBacktestRequestSchema>,
    res: ExpressResponse,
): Promise<void> {
    res.status(200).json(await getBacktestById(req.params.id));
}
