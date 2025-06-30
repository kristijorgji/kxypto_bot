import fs from 'fs';

import { v4 as uuidv4 } from 'uuid';

import { getBacktest } from '@src/db/repositories/backtests';
import { Backtest } from '@src/db/types';
import { logger, silentLogger } from '@src/logger';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';

import { BacktestConfig, BacktestFileConfig } from './types';
import { BacktestRunConfig } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

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
    const defaultStrategyLogger = config?.strategyLogger === 'silent' ? silentLogger : logger;

    return config.strategies.map(sc => strategyFromConfig(sc, defaultStrategyLogger));
}
