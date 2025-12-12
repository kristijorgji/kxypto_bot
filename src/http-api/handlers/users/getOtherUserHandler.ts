import { Response as ExpressResponse } from 'express';
import { z } from 'zod';

import { getOtherUserById } from '@src/db/repositories/users';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';

export const getOtherUserRequestSchema = {
    urlParams: z.object({
        id: z.string().uuid(),
    }),
} satisfies RequestSchemaObject;

export async function getOtherUserHandler(
    req: InferReq<typeof getOtherUserRequestSchema>,
    res: ExpressResponse,
): Promise<void> {
    res.status(200).json(await getOtherUserById(req.params.id));
}
