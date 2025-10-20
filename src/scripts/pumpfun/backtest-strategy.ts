import { program } from 'commander';
import { createLogger } from 'winston';

import { solToLamports } from '@src/blockchains/utils/amount';
import { redis } from '@src/cache/cache';
import { ActionSource, ActorContext } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { db } from '@src/db/knex';
import { getBacktestById } from '@src/db/repositories/backtests';
import { logger } from '@src/logger';
import { createPubSub } from '@src/pubsub';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';
import { parseBacktestFileConfig } from '@src/trading/backtesting/config-parser';
import { formPumpfunBacktestStatsDir } from '@src/trading/backtesting/data/pumpfun/utils';
import { BacktestRunConfig } from '@src/trading/bots/blockchains/solana/types';
import { PredictionSource } from '@src/trading/strategies/types';

import runAndSelectBestStrategy from '../../trading/backtesting/runAndSelectBestStrategy';
import BuyPredictionStrategy, {
    BuyPredictionStrategyConfig,
} from '../../trading/strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';

const pubsub = createPubSub();

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
        try {
            await start({
                backtestId: args.backtestId,
                config: args.config,
            });
        } finally {
            await db.destroy();
            redis.disconnect();
            pubsub.close();
        }
    });

program.parse();

/**
 * It will test the provided strategies against the history pumpfun data and print out the best performing
 */
async function start(args: { backtestId?: string; config?: string }) {
    if (args.backtestId && args.config) {
        throw new Error('Invalid configuration. You can either provide backtestId or config as an argument');
    }

    const runnerDeps = {
        logger: logger,
        backtestPubSub: new BacktestPubSub(pubsub),
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
        return await runAndSelectBestStrategy(runnerDeps, actorContext, await parseBacktestFileConfig(args.config));
    }

    if (args.backtestId) {
        return await runAndSelectBestStrategy(runnerDeps, actorContext, {
            backtest: await getBacktestById(args.backtestId),
            strategies: getStrategies(),
        });
    }

    await runAndSelectBestStrategy(runnerDeps, actorContext, {
        runConfig: getBacktestRunConfig(),
        strategies: getStrategies(),
    });
}

function getBacktestRunConfig(): BacktestRunConfig {
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

    const commonConfig: Partial<BuyPredictionStrategyConfig> = {
        prediction: {
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
        new BuyPredictionStrategy(silentLogger, redis, source, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.1,
            },
        }),
        new BuyPredictionStrategy(silentLogger, redis, source, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.3,
            },
        }),
        new BuyPredictionStrategy(silentLogger, redis, source, {
            ...commonConfig,
            buy: {
                minPredictedConfidence: 0.5,
            },
        }),
    ];
}
