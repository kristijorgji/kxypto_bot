import { program } from 'commander';
import { createLogger } from 'winston';

import Pumpfun from '@src/blockchains/solana/dex/pumpfun/Pumpfun';
import { solToLamports } from '@src/blockchains/utils/amount';
import { redis } from '@src/cache/cache';
import { ActionSource, ActorContext } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { db } from '@src/db/knex';
import { getBacktestById } from '@src/db/repositories/backtests';
import { logger } from '@src/logger';
import { createPubSub } from '@src/pubsub';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';
import { fileConfigToRunBacktestParams } from '@src/trading/backtesting/config-parser';
import { formPumpfunBacktestStatsDir } from '@src/trading/backtesting/data/pumpfun/utils';
import PumpfunBacktester from '@src/trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestConfig } from '@src/trading/bots/blockchains/solana/types';
import { PredictionSource } from '@src/trading/strategies/types';

import runBacktest from '../../trading/backtesting/runBacktest';
import BuyPredictionStrategy, {
    BuyPredictionStrategyConfigInput,
} from '../../trading/strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';

const pubsub = createPubSub();

async function cleanup(): Promise<void> {
    await db.destroy();
    redis.disconnect();
    await pubsub.close();
}

program
    .name('backtest-strategy')
    .description('Backtest the provided strategy(ies)')
    .version('0.0.0')
    .option(
        '--backtestId <string>',
        'existing backtest id if you want to store this strategy result as part of an existing backtest',
    )
    .option('--config <string>', 'path to a config file used for this backtest')
    .action(async args => {
        const abortState = { aborted: false };

        const handleExit = async () => {
            if (abortState.aborted) return;
            abortState.aborted = true;
            logger.debug('[Main] System interrupt received. Waiting for current task to finish...');
        };
        process.on('SIGINT', handleExit);

        try {
            await start({
                backtestId: args.backtestId,
                config: args.config,
                abortState: abortState,
            });
        } finally {
            process.off('SIGINT', handleExit);
            await cleanup();
            if (abortState.aborted) {
                logger.debug('[Main] Graceful shutdown complete....');
                process.exit(0);
            }
        }
    });

program.parse();

/**
 * It will test the provided strategies against the history pumpfun data and print out the best performing
 */
async function start(args: {
    backtestId?: string;
    config?: string;
    abortState: {
        aborted: boolean;
    };
}) {
    if (args.backtestId && args.config) {
        throw new Error('Invalid configuration. You can either provide backtestId or config as an argument');
    }

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

    /**
     * TODO resolve properly instead of hardcoding my user and cli
     */
    const actorContext: ActorContext = {
        source: ActionSource.Cli,
        userId: '6f5eee63-e50c-4f06-b2d6-6559e15db146',
    };

    if (args.config) {
        logger.info('Running backtest using config file: %s', args.config);
        return await runBacktest(
            runnerDeps,
            actorContext,
            await fileConfigToRunBacktestParams(args.config),
            args.abortState,
        );
    }

    if (args.backtestId) {
        return await runBacktest(
            runnerDeps,
            actorContext,
            {
                backtest: await getBacktestById(args.backtestId),
                strategies: getStrategies(),
            },
            args.abortState,
        );
    }

    await runBacktest(
        runnerDeps,
        actorContext,
        {
            backtestConfig: getBacktestConfig(),
            strategies: getStrategies(),
        },
        args.abortState,
    );
}

function getBacktestConfig(): BacktestConfig {
    const dataConfig = {
        path: formPumpfunBacktestStatsDir(),
        includeIfPathContains: ['no_trade'],
    };
    const files = getFiles(dataConfig);

    return {
        initialBalanceLamports: solToLamports(3),
        buyAmountSol: 1,
        jitoConfig: {
            jitoEnabled: true,
        },
        randomization: {
            priorityFees: true,
            slippages: 'closestEntry',
            execution: true,
        },
        onlyOneFullTrade: true,
        sellUnclosedPositionsAtEnd: true,
        data: {
            path: dataConfig.path,
            filesCount: files.length,
            includeIfPathContains: dataConfig.includeIfPathContains,
        },
    };
}

function getStrategies(): LaunchpadBotStrategy[] {
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });

    const source: PredictionSource = {
        endpoint: process.env.BUY_PREDICTION_ENDPOINT as string,
        algorithm: 'transformers',
        model: 'b.v1',
    };

    const commonConfig: BuyPredictionStrategyConfigInput = {
        predictionSource: source,
        predictionConfig: {
            requiredFeaturesLength: 10,
            upToFeaturesLength: 500,
            skipAllSameFeatures: true,
        },
        buy: {
            minPredictedConfidence: 0.7,
        },
        sell: {
            takeProfitPercentage: 10,
            stopLossPercentage: 15,
        },
    };

    return [
        new BuyPredictionStrategy(silentLogger, redis, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.1,
            },
        }),
        new BuyPredictionStrategy(silentLogger, redis, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.3,
            },
        }),
        new BuyPredictionStrategy(silentLogger, redis, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.5,
            },
        }),
    ];
}
