import { program } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { solToLamports } from '../../blockchains/utils/amount';
import { redis } from '../../cache/cache';
import { db } from '../../db/knex';
import {
    getBacktest,
    getBacktestStrategyResults,
    storeBacktest,
    storeBacktestStrategyResult,
} from '../../db/repositories/backtests';
import { Backtest } from '../../db/types';
import { logger } from '../../logger';
import { formPumpfunStatsDataFolder } from '../../trading/backtesting/data/pumpfun/utils';
import { logStrategyResult, runStrategy } from '../../trading/backtesting/utils';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig } from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import PredictionStrategy, {
    PredictionSource,
    PredictionStrategyConfig,
} from '../../trading/strategies/launchpads/PredictionStrategy';
import { walkDirFilesSyncRecursive } from '../../utils/files';
import { formatElapsedTime } from '../../utils/time';

program
    .name('backtest-strategy')
    .description('Backtest the provided strategy(ies)')
    .version('0.0.0')
    .option(
        '--backtestId <string>',
        'existing backtest id if you want to store this strategy result as part of an existing backtest',
    )
    .action(async args => {
        try {
            await findBestStrategy({
                backtestId: args.backtestId,
            });
        } finally {
            await db.destroy();
            redis.disconnect();
        }
    });

program.parse();

/**
 * It will test the provided strategies against the history pumpfun data stored in data/pumpfun-stats
 */
async function findBestStrategy(args: { backtestId?: string }) {
    const start = process.hrtime();

    const backtestId = args.backtestId ?? uuidv4();
    let existingBacktest: Backtest | undefined;
    if (args.backtestId) {
        existingBacktest = await getBacktest(args.backtestId);
    }

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });
    const backtester = new PumpfunBacktester(logger);

    const pumpfunStatsPath = existingBacktest ? existingBacktest.config.data.path : formPumpfunStatsDataFolder();
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json').filter(el =>
        el.fullPath.includes('no_trade'),
    );
    const totalFiles = files.length;
    if (existingBacktest && existingBacktest.config.data.filesCount !== totalFiles) {
        throw new Error(
            `Cannot resume the existing backtest: expected ${existingBacktest.config.data.filesCount} file(s), but found ${totalFiles} file(s).`,
        );
    }
    let tested = 0;

    const baseRunConfig: Omit<BacktestRunConfig, 'strategy'> = existingBacktest
        ? (existingBacktest.config as unknown as Omit<BacktestRunConfig, 'strategy'>)
        : {
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
          };
    if (existingBacktest) {
        delete (baseRunConfig as unknown as { data: never }).data;
    }

    if (!args.backtestId) {
        await storeBacktest({
            id: backtestId,
            config: {
                data: {
                    path: pumpfunStatsPath,
                    filesCount: totalFiles,
                },
                ...baseRunConfig,
            },
        });
    }

    const source: PredictionSource = {
        endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
        model: 'v13_gru',
    };
    const config: Partial<PredictionStrategyConfig> = {
        requiredFeaturesLength: 10,
        upToFeaturesLength: 500,
        skipAllSameFeatures: true,
        buy: {
            minPredictedPriceIncreasePercentage: 20,
        },
        sell: {
            takeProfitPercentage: 10,
            stopLossPercentage: 15,
        },
    };

    const strategies: LaunchpadBotStrategy[] = [
        new PredictionStrategy(silentLogger, redis, source, {
            ...config,
            buy: {
                minPredictedPriceIncreasePercentage: 20,
            },
        }),
        new PredictionStrategy(silentLogger, redis, source, {
            ...config,
            buy: {
                minPredictedPriceIncreasePercentage: 15,
            },
        }),
        new PredictionStrategy(silentLogger, redis, source, {
            ...config,
            buy: {
                minPredictedPriceIncreasePercentage: 10,
            },
        }),
    ];

    const strategiesCount = strategies.length;
    logger.info('Started backtest with id %s - will test %d strategies\n', backtestId, strategiesCount);

    for (const strategy of strategies) {
        const runConfig: BacktestRunConfig = {
            ...baseRunConfig,
            strategy: strategy,
        };

        logger.info(
            '[%d] Will test strategy %s with variant config: %s against %d historical data, config=%o\n%s',
            tested,
            runConfig.strategy.identifier,
            runConfig.strategy.configVariant,
            totalFiles,
            runConfig.strategy.config,
            '='.repeat(100),
        );

        const strategyStartTime = process.hrtime();
        const sr = await runStrategy(
            {
                backtester: backtester,
                pumpfun: pumpfun,
                logger: logger,
            },
            runConfig,
            files,
            {
                verbose: true,
            },
        );
        const executionTime = process.hrtime(strategyStartTime);
        const executionTimeInS = (executionTime[0] * 1e9 + executionTime[1]) / 1e9;

        logStrategyResult(
            logger,
            {
                strategyId: strategy.identifier,
                tested: tested,
                total: strategiesCount,
                executionTimeInS: executionTimeInS,
            },
            sr,
        );
        await storeBacktestStrategyResult(backtestId, runConfig.strategy, sr, executionTimeInS);

        tested++;
    }

    const bestStrategyResult = (
        await getBacktestStrategyResults(backtestId, {
            orderBy: {
                columnName: 'pnl_sol',
                order: 'desc',
            },
            limit: 1,
        })
    )[0];

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    logger.info('Finished testing %d strategies in %s', tested, formatElapsedTime(timeInNs / 1e9));
    logger.info(
        'The best strategy is: %s with variant config: %s, config: %o',
        bestStrategyResult.strategy_id,
        bestStrategyResult.config_variant,
        bestStrategyResult.config,
    );
}
