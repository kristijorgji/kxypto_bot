import { Response as ExpressResponse } from 'express';

import { ActionSource, ActorContext } from '@src/core/types';
import { createBacktestRun } from '@src/db/repositories/backtests';
import { ProcessingStatus } from '@src/db/types';
import { InferReq, RequestSchemaObject } from '@src/http-api/middlewares/validateRequestMiddleware';
import { ExtendedRequest } from '@src/http-api/types';
import { backtestRunQueue } from '@src/queues/backtestRun.queue';
import { rangeAwareBacktestRunConfigSchema } from '@src/trading/backtesting/types';

export const scheduleBacktestRunRequestSchema = {
    body: rangeAwareBacktestRunConfigSchema,
} satisfies RequestSchemaObject;

export default async (req: InferReq<typeof scheduleBacktestRunRequestSchema>, res: ExpressResponse) => {
    const actorContext: ActorContext = {
        source: ActionSource.App,
        userId: (req as ExtendedRequest).jwtPayload!.userId,
    };

    const backtestRun = await createBacktestRun({
        backtest_id: (req.validated.body as { backtestId: string }).backtestId,
        source: actorContext.source,
        status: ProcessingStatus.Pending,
        user_id: actorContext?.userId ?? null,
        api_client_id: actorContext?.apiClientId ?? null,
        started_at: null, // this will be set once started and updated status to RUNNING
        config: req.validated.body,
    });

    await backtestRunQueue.add('execute-backtest-run', {
        backtestRunId: backtestRun.id,
    });

    res.json(backtestRun);
};
