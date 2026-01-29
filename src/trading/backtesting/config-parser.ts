import fs from 'fs';

import { getBacktestById } from '@src/db/repositories/backtests';
import { Backtest } from '@src/db/types';
import { logger, silentLogger } from '@src/logger';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';

import { BacktestRunConfig, RunBacktestParams, backtestRunConfigSchema } from './types';
import { BacktestConfig } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

export async function fileConfigToRunBacktestParams(path: string): Promise<RunBacktestParams> {
    return backtestRunToRunBacktestParams(backtestRunConfigSchema.parse(JSON.parse(fs.readFileSync(path).toString())));
}

export async function backtestRunToRunBacktestParams(config: BacktestRunConfig): Promise<RunBacktestParams> {
    let backtest: Backtest | undefined;

    if ((config as { backtestId?: string })?.backtestId) {
        backtest = await getBacktestById((config as { backtestId: string }).backtestId);
        return {
            backtest: backtest,
            strategies: formStrategiesFromConfig(config),
        };
    } else {
        return {
            backtestConfig: (config as { config: BacktestConfig }).config,
            strategies: formStrategiesFromConfig(config),
        };
    }
}

function formStrategiesFromConfig(config: BacktestRunConfig): LaunchpadBotStrategy[] {
    const defaultStrategyLogger = config?.strategyLogger === 'silent' ? silentLogger : logger;

    return config.strategies.map(sc => strategyFromConfig(sc, defaultStrategyLogger));
}
