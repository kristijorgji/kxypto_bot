import { Response as ExpressResponse } from 'express';
import { z } from 'zod';

import { deleteBacktestStrategyById } from '@src/db/repositories/backtests';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';

export const deleteStrategyResultByIdRequestSchema = {
    urlParams: z.object({
        id: z.coerce.number().int().positive(),
    }),
} satisfies RequestSchemaObject;

export async function deleteStrategyResultByIdHandler(
    req: InferReq<typeof deleteStrategyResultByIdRequestSchema>,
    res: ExpressResponse,
): Promise<void> {
    await deleteBacktestStrategyById(req.validated.urlParams.id);

    res.status(200).send();
}
