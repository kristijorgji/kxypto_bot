import fs from 'fs';

import { getBacktestById } from '@src/db/repositories/backtests';
import { Backtest } from '@src/db/types';
import { logger, silentLogger } from '@src/logger';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';

import { BacktestConfig, BacktestFileConfig, backtestFileConfigSchema } from './types';
import { BacktestRunConfig } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

export async function parseBacktestFileConfig(path: string): Promise<BacktestConfig> {
    const config = backtestFileConfigSchema.parse(JSON.parse(fs.readFileSync(path).toString()));

    let backtest: Backtest | undefined;
    if ((config as { backtestId?: string })?.backtestId) {
        backtest = await getBacktestById((config as { backtestId: string }).backtestId);
        return {
            backtest: backtest,
            strategies: formStrategiesFromConfig(config),
        };
    } else {
        return {
            runConfig: (config as { runConfig: BacktestRunConfig }).runConfig,
            strategies: formStrategiesFromConfig(config),
        };
    }
}

function formStrategiesFromConfig(config: BacktestFileConfig): LaunchpadBotStrategy[] {
    const defaultStrategyLogger = config?.strategyLogger === 'silent' ? silentLogger : logger;

    return config.strategies.map(sc => strategyFromConfig(sc, defaultStrategyLogger));
}
