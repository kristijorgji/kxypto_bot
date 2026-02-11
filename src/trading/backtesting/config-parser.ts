import fs from 'fs';

import { getBacktestById } from '@src/db/repositories/backtests';
import { Backtest } from '@src/db/types';
import { logger, silentLogger } from '@src/logger';
import { countPermutations } from '@src/trading/backtesting/utils/countPermutations';
import { generatePermutationsGenerator } from '@src/trading/backtesting/utils/permutationGenerator';
import { StrategyFileConfig, strategyFileConfigSchema } from '@src/trading/config/types';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';
import LaunchpadBotStrategy from '@src/trading/strategies/launchpads/LaunchpadBotStrategy';

import {
    BacktestRunConfig,
    RunBacktestFromRunConfigParams,
    RunBacktestParams,
    rangeAwareBacktestRunConfigSchema,
} from './types';
import { BacktestConfig } from '../bots/blockchains/solana/types';

export async function fileConfigToRunBacktestParams(path: string): Promise<RunBacktestParams> {
    return backtestRunToRunBacktestParams(
        rangeAwareBacktestRunConfigSchema.parse(JSON.parse(fs.readFileSync(path).toString())),
    );
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

function formStrategiesFromConfig(config: BacktestRunConfig): RunBacktestFromRunConfigParams['strategies'] {
    const defaultStrategyLogger = config?.strategyLogger === 'silent' ? silentLogger : logger;

    return config.strategies.map(sc => {
        const pCount = countPermutations(sc);

        if (pCount > 1) {
            const configGenerator = generatePermutationsGenerator<StrategyFileConfig>(
                sc,
                strategyFileConfigSchema.parse,
            );

            const strategyInstanceGenerator = function* (): Generator<LaunchpadBotStrategy> {
                for (const permutedConfig of configGenerator) {
                    yield strategyFromConfig(permutedConfig, defaultStrategyLogger);
                }
            };

            return {
                generator: strategyInstanceGenerator(),
                permutationsCount: pCount,
            };
        }

        return strategyFromConfig(sc, defaultStrategyLogger);
    });
}
