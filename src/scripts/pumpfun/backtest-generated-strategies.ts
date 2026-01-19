import { v4 as uuidv4 } from 'uuid';
import { createLogger } from 'winston';

import { solToLamports } from '@src/blockchains/utils/amount';
import { redis } from '@src/cache/cache';
import { ActionSource } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { db } from '@src/db/knex';
import {
    createBacktestRun,
    initBacktestStrategyResult,
    storeBacktest,
    updateBacktestRunStatus,
    updateBacktestStrategyResult,
} from '@src/db/repositories/backtests';
import { ProcessingStatus } from '@src/db/types';
import { logger } from '@src/logger';
import { formPumpfunBacktestStatsDir } from '@src/trading/backtesting/data/pumpfun/utils';
import {
    StrategyResultLiveState,
    createInitialStrategyResultLiveState,
    logStrategyResult,
    runStrategy,
} from '@src/trading/backtesting/utils';
import {
    BacktestRunConfig,
    BacktestStrategyRunConfig,
    StrategyBacktestResult,
} from '@src/trading/bots/blockchains/solana/types';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import RiseStrategyConfigGenerator, {
    StartState,
} from '../../trading/backtesting/strategies/RiseStrategyConfigGenerator';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import RiseStrategy, { RiseStrategyConfig } from '../../trading/strategies/launchpads/RiseStrategy';

const riseStrategyConfigGenerator = new RiseStrategyConfigGenerator();

(async () => {
    ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection', 'exit', 'beforeExit'].forEach(event => {
        process.on(event, async err => {
            logger.info(`Received event: ${event}`);
            if (err instanceof Error) {
                logger.error(err);
            }

            await cleanup();

            logger.info('riseStrategyConfigGenerator.resumeState=%o', riseStrategyConfigGenerator.resumeState);
            process.exit(event === 'exit' ? 0 : 1);
        });
    });

    try {
        await start();
    } finally {
        await cleanup();
    }
})();

async function cleanup() {
    await db.destroy();
    redis.disconnect();
}

/**
 * It will test auto generated strategy combinations, backtest them and find the best configuration to use
 */
async function start() {
    await findBestStrategy();
}

async function findBestStrategy() {
    const start = process.hrtime();

    const backtestId = uuidv4();

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });
    const backtester = new PumpfunBacktester(logger);

    const dataConfig = {
        path: formPumpfunBacktestStatsDir(),
        includeIfPathContains: ['no_trade/no_pump', '/trade/'],
    };
    const files = getFiles(dataConfig);
    const runConfig: BacktestRunConfig = {
        initialBalanceLamports: solToLamports(1),
        buyAmountSol: 0.4,
        jitoConfig: {
            jitoEnabled: true,
        },
        randomization: {
            priorityFees: true,
            slippages: 'closestEntry',
            execution: true,
        },
        onlyOneFullTrade: true,
        sellUnclosedPositionsAtEnd: false,
        data: {
            path: dataConfig.path,
            filesCount: files.length,
            includeIfPathContains: dataConfig.includeIfPathContains,
        },
    };

    await storeBacktest({
        id: backtestId,
        chain: 'solana',
        name: `gen_${Date.now()}`,
        config: runConfig,
    });

    const results: {
        strategy: LaunchpadBotStrategy;
        result: StrategyBacktestResult;
    }[] = [];

    const s: StartState = {
        holdersCount: [5, 30],
        bondingCurveProgress: [15, 35],
        devHoldingPercentage: [5, 20],
        topTenHoldingPercentage: [1, 50],
        trailingStopLossPercentage: [10, 20],
        takeProfitPercentage: [10, 25],
    };

    const total = riseStrategyConfigGenerator.calculateTotalCombinations(s);
    logger.info('Running backtest %s, will test %d strategies\n', backtestId, total);

    const baseConfig: Partial<RiseStrategyConfig> = {
        priorityFeeInSol: 0.007,
    };

    let tested = 0;

    /**
     * TODO resolve properly instead of hardcoding my user and cli
     */
    const backtestRun = await createBacktestRun({
        backtest_id: backtestId,
        source: ActionSource.Cli,
        status: ProcessingStatus.Running,
        user_id: '6f5eee63-e50c-4f06-b2d6-6559e15db146',
        api_client_id: null,
        started_at: new Date(),
    });

    let currentStrategyLiveState: StrategyResultLiveState | undefined;

    for (const config of riseStrategyConfigGenerator.formConfigs(s)) {
        const backtestStrategyRunConfig: BacktestStrategyRunConfig = {
            ...runConfig,
            strategy: new RiseStrategy(silentLogger, {
                ...baseConfig,
                ...config,
            }),
        };

        logger.info(
            '[%d] Will test strategy %s with variant config: %s against %d historical data\n%s',
            tested,
            backtestStrategyRunConfig.strategy.identifier,
            backtestStrategyRunConfig.strategy.configVariant,
            files.length,
            '='.repeat(100),
        );

        const runningPartialStrategyResult = await initBacktestStrategyResult(
            backtestId,
            backtestRun.id,
            backtestStrategyRunConfig.strategy,
            ProcessingStatus.Running,
        );
        const strategyStartTime = process.hrtime();
        currentStrategyLiveState = createInitialStrategyResultLiveState();
        const sr = await runStrategy(
            {
                backtester: backtester,
                pumpfun: pumpfun,
                logger: logger,
            },
            {
                ls: currentStrategyLiveState,
                pausedRef: () => false,
                abortedRef: () => false,
            },
            backtestStrategyRunConfig,
            files,
        );
        results.push({
            strategy: backtestStrategyRunConfig.strategy,
            result: sr,
        });
        const executionTime = process.hrtime(strategyStartTime);
        const executionTimeInS = (executionTime[0] * 1e9 + executionTime[1]) / 1e9;

        logStrategyResult(
            logger,
            {
                strategyId: backtestStrategyRunConfig.strategy.identifier,
                tested: tested,
                total: total,
                executionTimeInS: executionTimeInS,
            },
            sr,
        );
        await updateBacktestStrategyResult(
            runningPartialStrategyResult.id,
            ProcessingStatus.Completed,
            sr,
            executionTimeInS,
        );

        tested++;
    }

    results.sort((a, b) => b.result.totalPnlInSol - a.result.totalPnlInSol);

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    await updateBacktestRunStatus(backtestRun.id, ProcessingStatus.Completed);

    logger.info('Finished testing %d strategies in %s seconds\n', tested, timeInNs / 1e9);
    logger.info(
        'The best strategy of this backtest is: %s with variant config: %s, config: %o',
        results[0].strategy.identifier,
        results[0].strategy.configVariant,
        results[0].strategy.config,
        results,
    );
}
