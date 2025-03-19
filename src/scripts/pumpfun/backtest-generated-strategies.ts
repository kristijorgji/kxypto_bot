import { v4 as uuidv4 } from 'uuid';
import { createLogger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { solToLamports } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { logger } from '../../logger';
import RiseStrategyConfigGenerator, {
    StartState,
} from '../../trading/backtesting/strategies/RiseStrategyConfigGenerator';
import { logStrategyResult, runStrategy, storeBacktest, storeStrategyResult } from '../../trading/backtesting/utils';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig, StrategyBacktestResult } from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import RiseStrategy, { RiseStrategyConfig } from '../../trading/strategies/launchpads/RiseStrategy';
import { walkDirFilesSyncRecursive } from '../../utils/files';
import { formDataFolder } from '../../utils/storage';

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

    const pumpfunStatsPath = formDataFolder('pumpfun-stats');
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath).filter(
        el => el.fullPath.includes('no_trade/no_pump') || el.fullPath.includes('/trade/'),
    );
    let tested = 0;

    const baseRunConfig: Omit<BacktestRunConfig, 'strategy'> = {
        initialBalanceLamports: solToLamports(1),
        buyAmountSol: 0.4,
        jitoConfig: {
            jitoEnabled: true,
        },
        useRandomizedValues: true,
        onlyOneFullTrade: true,
        allowNegativeBalance: false,
    };

    await storeBacktest({
        id: backtestId,
        config: {
            data: {
                path: pumpfunStatsPath,
                filesCount: files.length,
            },
            ...baseRunConfig,
        },
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

    for (const config of riseStrategyConfigGenerator.formConfigs(s)) {
        const runConfig: BacktestRunConfig = {
            ...baseRunConfig,
            strategy: new RiseStrategy(silentLogger, {
                ...baseConfig,
                ...config,
            }),
        };

        logger.info(
            '[%d] Will test strategy %s with variant config: %s against %d historical data\n%s',
            tested,
            runConfig.strategy.identifier,
            runConfig.strategy.configVariant,
            files.length,
            '='.repeat(100),
        );

        const sr = await runStrategy(
            {
                backtester: backtester,
                pumpfun: pumpfun,
            },
            runConfig,
            files,
        );
        results.push({
            strategy: runConfig.strategy,
            result: sr,
        });
        tested++;

        logStrategyResult(logger, sr, tested, total);
        await storeStrategyResult(backtestId, runConfig.strategy, sr);
    }

    results.sort((a, b) => b.result.totalPnlInSol - a.result.totalPnlInSol);

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    logger.info('Finished testing %d strategies in %s seconds', tested, timeInNs / 1e9);
    logger.info(
        'The best strategy is: %s with variant config: %s, config: %o',
        results[0].strategy.identifier,
        results[0].strategy.configVariant,
        results[0].strategy.config,
        results,
    );
}
