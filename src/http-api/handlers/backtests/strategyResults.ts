import { Response as ExpressResponse, Request } from 'express';
import { z } from 'zod';

import { deleteBacktestStrategyById } from '@src/db/repositories/backtests';

const deleteUrlParamsSchema = z.object({
    id: z.coerce.number().int().positive(),
});

export async function deleteStrategyResultByIdHandler(req: Request, res: ExpressResponse): Promise<void> {
    let urlParams: z.infer<typeof deleteUrlParamsSchema>;

    try {
        urlParams = deleteUrlParamsSchema.parse(req.params);
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({
                error: error.flatten().fieldErrors,
            });
            return;
        }
        throw error;
    }

    await deleteBacktestStrategyById(urlParams.id);

    res.status(200).send();
}
