import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { backtestRunQueue } from './backtestRun.queue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
    queues: [
        new BullMQAdapter(backtestRunQueue),
        // Add more queues here as you grow: new BullMQAdapter(emailQueue)
    ],
    serverAdapter: serverAdapter,
});

export { serverAdapter };
