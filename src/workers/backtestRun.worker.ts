import { Worker } from 'bullmq';

import { logger } from '@src/logger';
import { Queues, queueConnection } from '@src/queues/config';
import { backtestRunProcessor } from '@src/workers/backtestRun.processor';

export const loggerWorkerPrefix = `[w][${Queues.BacktestRun}]`;

/**
 * TODO: Migration to Sandboxed Processors
 * * Current Implementation:
 * Runs as a Functional Processor in the main event loop.
 * * Why change to Sandboxed?
 * 1. CPU Blocking: Backtesting is math-heavy. In the main thread, it can block the Event Loop,
 * causing the Worker to miss "heartbeats" to Redis. This leads to "stalled job"
 * errors where BullMQ retries the same job repeatedly.
 * 2. Parallelism: Using `processorPath` with `useWorkerThreads: true` allows each backtest
 * to run on a separate CPU core, providing true horizontal scaling on a single machine.
 * 3. Memory Isolation: If a specific backtest leaks memory or crashes, it won't bring
 * down the entire Server/Worker process.
 * * Obstacles to solve:
 * - Requires resolving "Unknown file extension .ts" by passing ts-node loaders via
 * `workerOpts.execArgv` or running the compiled .js in production.
 */

export const backtestWorker = new Worker(Queues.BacktestRun, backtestRunProcessor, {
    connection: queueConnection,
    concurrency: Number(process.env.MAX_CONCURRENT_BACKTESTS || 1),
});

backtestWorker.on('completed', job => logger.info(`${loggerWorkerPrefix} Finished job ${job.id}`));
