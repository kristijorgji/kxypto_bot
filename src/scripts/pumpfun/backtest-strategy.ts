import { v4 as uuidv4 } from 'uuid';
import { createLogger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { solToLamports } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { logger } from '../../logger';
import { formPumpfunStatsDataFolder } from '../../trading/backtesting/data/pumpfun/utils';
import { logStrategyResult, runStrategy, storeBacktest, storeStrategyResult } from '../../trading/backtesting/utils';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig, StrategyBacktestResult } from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import PredictionStrategy from '../../trading/strategies/launchpads/PredictionStrategy';
import { walkDirFilesSyncRecursive } from '../../utils/files';

(async () => {
    start().finally(() => {
        db.destroy();
    });
})();

/**
 * It will test the provided strategies against the history pumpfun data stored in data/pumpfun-stats
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

    const pumpfunStatsPath = formPumpfunStatsDataFolder();
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json').filter(el =>
        el.fullPath.includes('no_trade'),
    );
    let tested = 0;

    const strategies: LaunchpadBotStrategy[] = [
        new PredictionStrategy(
            silentLogger,
            {
                endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
            },
            {
                variant: 'v5_short_ancor',
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
            },
        ),
    ];
    const results: {
        strategy: LaunchpadBotStrategy;
        result: StrategyBacktestResult;
    }[] = [];

    const baseRunConfig: Omit<BacktestRunConfig, 'strategy'> = {
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

    const strategiesCount = strategies.length;
    logger.info('Started backtest with id %s - will test %d strategies\n', backtestId, strategiesCount);

    for (const strategy of strategies) {
        const runConfig: BacktestRunConfig = {
            ...baseRunConfig,
            strategy: strategy,
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
                logger: logger,
            },
            runConfig,
            files,
            {
                verbose: true,
            },
        );
        results.push({
            strategy: strategy,
            result: sr,
        });
        tested++;

        logStrategyResult(logger, sr, tested, strategiesCount);
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
