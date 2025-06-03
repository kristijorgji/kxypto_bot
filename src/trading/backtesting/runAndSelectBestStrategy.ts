import { v4 as uuidv4 } from 'uuid';

import { BacktestConfig } from './types';
import { getBacktestFiles, logStrategyResult, runStrategy } from './utils';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    getBacktestStrategyResults,
    storeBacktest,
    storeBacktestStrategyResult,
} from '../../db/repositories/backtests';
import { Backtest } from '../../db/types';
import { logger } from '../../logger';
import { formatElapsedTime } from '../../utils/time';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig, BacktestStrategyRunConfig } from '../bots/blockchains/solana/types';

export default async function runAndSelectBestStrategy(config: BacktestConfig): Promise<void> {
    const start = process.hrtime();

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const backtester = new PumpfunBacktester(logger);

    const backtestId = (config as { backtest?: Backtest })?.backtest?.id ?? uuidv4();
    let backtest: Backtest;
    let runConfig: BacktestRunConfig;
    if ((config as { backtest?: Backtest })?.backtest) {
        backtest = (config as { backtest: Backtest }).backtest;
        runConfig = backtest.config;
    } else {
        runConfig = (config as { runConfig: BacktestRunConfig }).runConfig;
        backtest = {
            id: backtestId,
            config: runConfig,
        };
        await storeBacktest(backtest);
    }

    const files = getBacktestFiles(runConfig.data);
    const totalFiles = files.length;
    if (runConfig && runConfig.data.filesCount !== totalFiles) {
        throw new Error(
            `Cannot resume the existing backtest: expected ${runConfig.data.filesCount} file(s), but found ${totalFiles} file(s), config.data=${JSON.stringify(runConfig.data)}`,
        );
    }

    const strategiesCount = config.strategies.length;
    logger.info(
        'Started backtest with id %s%s against %d strategies, config=%o\n',
        backtestId,
        backtest.name ? `, name ${backtest.name}` : '',
        strategiesCount,
        backtest.config,
    );

    let tested = 0;

    for (const strategy of config.strategies) {
        const backtestStrategyRunConfig: BacktestStrategyRunConfig = {
            ...runConfig,
            strategy: strategy,
        };

        logger.info(
            '[%d] Will test strategy %s with variant config: %s against %d historical data, config=%o\n%s',
            tested,
            backtestStrategyRunConfig.strategy.identifier,
            backtestStrategyRunConfig.strategy.configVariant,
            totalFiles,
            backtestStrategyRunConfig.strategy.config,
            '='.repeat(100),
        );

        const strategyStartTime = process.hrtime();
        const sr = await runStrategy(
            {
                backtester: backtester,
                pumpfun: pumpfun,
                logger: logger,
            },
            backtestStrategyRunConfig,
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
        await storeBacktestStrategyResult(backtestId, backtestStrategyRunConfig.strategy, sr, executionTimeInS);

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
