import { Queue } from 'bullmq';

import { Queues, queueConnection } from '@src/queues/config';

export const backtestRunQueue = new Queue(Queues.BacktestRun, {
    connection: queueConnection,
    defaultJobOptions: {
        attempts: 1,
        backoff: { type: 'exponential', delay: 1000 },
        // removeOnComplete: true,
    },
});
