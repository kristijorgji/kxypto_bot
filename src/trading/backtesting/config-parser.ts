import fs from 'fs';

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from 'winston';

import { BacktestConfig, BacktestFileConfig } from './types';
import { redis } from '../../cache/cache';
import { getBacktest } from '../../db/repositories/backtests';
import { Backtest } from '../../db/types';
import { logger } from '../../logger';
import { BacktestRunConfig } from '../bots/blockchains/solana/types';
import BuyPredictionStrategy from '../strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';
import PricePredictionStrategy from '../strategies/launchpads/PricePredictionStrategy';

export async function parseBacktestFileConfig(path: string): Promise<BacktestConfig> {
    const config = JSON.parse(fs.readFileSync(path).toString()) as BacktestFileConfig;

    const backtestId = (config as { backtestId?: string })?.backtestId ?? uuidv4();
    let backtest: Backtest;
    if ((config as { backtestId?: string })?.backtestId) {
        backtest = await getBacktest((config as { backtestId: string }).backtestId);
    } else {
        backtest = {
            id: backtestId,
            config: (config as { runConfig: BacktestRunConfig }).runConfig,
        };
    }

    return {
        backtest: backtest,
        strategies: formStrategiesFromConfig(config),
    };
}

function formStrategiesFromConfig(config: BacktestFileConfig): LaunchpadBotStrategy[] {
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });
    const defaultStrategyLogger = config?.strategyLogger === 'silent' ? silentLogger : logger;

    const strategies: LaunchpadBotStrategy[] = [];

    for (const sc of config.strategies) {
        const strategyLogger = sc?.logger ? (sc.logger === 'silent' ? silentLogger : logger) : defaultStrategyLogger;
        const type = sc.type;
        switch (type) {
            case 'BuyPredictionStrategy':
                strategies.push(new BuyPredictionStrategy(strategyLogger, redis, sc.source, sc.config));
                break;
            case 'PricePredictionStrategy':
                strategies.push(new PricePredictionStrategy(strategyLogger, redis, sc.source, sc.config));
                break;
            default:
                throw new Error(`Unknown strategy type ${type}`);
        }
    }

    return strategies;
}
