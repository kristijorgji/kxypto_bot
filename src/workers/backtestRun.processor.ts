import { Job } from 'bullmq';

import Pumpfun from '@src/blockchains/solana/dex/pumpfun/Pumpfun';
import { ActionSource, ActorContext } from '@src/core/types';
import { getBacktestRunById, markBacktestRunAsFailed } from '@src/db/repositories/backtests';
import { BacktestRun } from '@src/db/types';
import { logger } from '@src/logger';
import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { createPubSub } from '@src/pubsub';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';
import { backtestRunToRunBacktestParams } from '@src/trading/backtesting/config-parser';
import runBacktest from '@src/trading/backtesting/runBacktest';
import { BacktestRunConfig } from '@src/trading/backtesting/types';
import PumpfunBacktester from '@src/trading/bots/blockchains/solana/PumpfunBacktester';
import { sleep } from '@src/utils/functions';
import { loggerWorkerPrefix } from '@src/workers/backtestRun.worker';

export async function backtestRunProcessor(job: Job) {
    logger.info(`${loggerWorkerPrefix} Started`);
    const { backtestRunId } = job.data;

    const pubsub = createPubSub();
    const runnerDeps = {
        logger: logger,
        pubsub: pubsub,
        backtestPubSub: new BacktestPubSub(pubsub),
        pumpfun: new Pumpfun({
            rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        }),
        backtester: new PumpfunBacktester(logger),
    };

    logger.info(`${loggerWorkerPrefix} Starting backtest run with id ${backtestRunId}`);

    await sleep(100); // for the app to use the first message after created

    const backtestRun = await getBacktestRunById(backtestRunId);

    try {
        await runBacktest(
            runnerDeps,
            actorFromBacktestRun(backtestRun as BacktestRun),
            {
                backtestRun: backtestRun as ProtoBacktestRun,
                ...(await backtestRunToRunBacktestParams(backtestRun.config as BacktestRunConfig)),
            },
            {
                aborted: false,
            },
        );
    } catch (error) {
        logger.error(`${loggerWorkerPrefix} Job ${job.id} failed`, error);

        await sleep(100); // for the app to process pending message first, if 2 come at the same time might add 2 entries

        runnerDeps.backtestPubSub.publishBacktestRun({
            id: backtestRunId.toString(),
            action: 'updated',
            data: {
                ...(backtestRun as ProtoBacktestRun),
                ...(await markBacktestRunAsFailed(backtestRun.id, {
                    message: (error as Error).message,
                    stack: (error as Error).stack,
                    timestamp: new Date().toISOString(),
                })),
            },
            version: 2,
        });

        // wait to publish update above
        await sleep(5e3);
        logger.error(`${loggerWorkerPrefix} will rethrow error in catch block`);

        throw error; // Let BullMQ handle the retry logic
    }
}

function actorFromBacktestRun(backtestRun: BacktestRun): ActorContext {
    if (backtestRun.source === ActionSource.System) {
        return {
            source: ActionSource.System,
        };
    }

    if (backtestRun.source === ActionSource.ApiClient) {
        return {
            source: ActionSource.ApiClient,
            apiClientId: backtestRun.api_client_id!,
        };
    }

    return {
        source: backtestRun.source,
        userId: backtestRun.user_id!,
    };
}
