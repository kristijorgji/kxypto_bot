import { createLogger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { solToLamports } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { logger } from '../../logger';
import { logStrategyResult, runStrategy } from '../../trading/backtesting/utils';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig, StrategyBacktestResult } from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';
import StupidSniperStrategy from '../../trading/strategies/launchpads/StupidSniperStrategy';
import { walkDirFilesSyncRecursive } from '../../utils/files';
import { formDataFolder } from '../../utils/storage';

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
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath).filter(el => el.fullPath.includes('no_trade/no_pump'));
    let tested = 0;

    const strategies: LaunchpadBotStrategy[] = [new RiseStrategy(silentLogger), new StupidSniperStrategy(silentLogger)];
    const results: {
        strategy: LaunchpadBotStrategy;
        result: StrategyBacktestResult;
    }[] = [];

    const total = strategies.length;
    logger.info('Will test %d strategies\n', total);

    for (const strategy of strategies) {
        const runConfig: BacktestRunConfig = {
            initialBalanceLamports: solToLamports(1),
            strategy: strategy,
            buyAmountSol: 0.4,
            onlyOneFullTrade: true,
            allowNegativeBalance: false,
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
            strategy: strategy,
            result: sr,
        });
        tested++;

        logStrategyResult(logger, sr, tested, total);
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
