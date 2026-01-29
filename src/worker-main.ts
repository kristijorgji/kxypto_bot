import { logger } from '@src/logger';
import { backtestWorker } from '@src/workers/backtestRun.worker';

const workers = [backtestWorker];

logger.info(`🚀 ${workers.length} Workers are running and listening for jobs...`);

const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully shutting down ${workers.length} workers...`);

    // Set a safety timeout to force exit if workers take too long to close
    const forceExitTimeout = setTimeout(() => {
        logger.error('Shutdown timed out. Forcefully exiting...');
        process.exit(1);
    }, 30000); // 30 seconds

    try {
        // Close all workers in parallel
        await Promise.all(workers.map(worker => worker.close()));

        clearTimeout(forceExitTimeout);
        logger.info('All workers closed gracefully. Exiting process.');
        process.exit(0);
    } catch (err) {
        logger.error('Error during graceful shutdown:', err);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
