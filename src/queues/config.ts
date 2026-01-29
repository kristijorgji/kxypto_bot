export const queueConnection = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT!),
};

export const Queues = {
    BacktestRun: 'backtest-run-queue',
};
