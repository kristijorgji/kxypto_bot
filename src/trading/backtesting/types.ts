import { z } from 'zod';

import { Backtest } from '@src/db/types';
import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { loggerTypeSchema, strategyFileConfigSchema } from '@src/trading/config/types';
import { upgradeToRangeAware } from '@src/utils/zod/upgradeToRangeAware';

import { BacktestConfig, backtestConfigSchema } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

export const backtestRunConfigSchema = z
    .object({
        strategyLogger: loggerTypeSchema.optional(),
        strategies: z.array(strategyFileConfigSchema),
    })
    .and(
        z.union([
            z.object({
                backtestId: z.string(),
            }),
            z.object({
                config: backtestConfigSchema,
            }),
        ]),
    );
export type BacktestRunConfig = z.infer<typeof backtestRunConfigSchema>;

export const rangeAwareBacktestRunConfigSchema = upgradeToRangeAware(backtestRunConfigSchema);

export type StrategyPermutationSet = {
    generator: Generator<LaunchpadBotStrategy>;
    permutationsCount: number;
};

export type StrategyExecutionItem = LaunchpadBotStrategy | StrategyPermutationSet;

/**
 * Type Guard to narrow down a strategy item to a permutation set.
 */
export function isStrategyPermutation(item: StrategyExecutionItem): item is StrategyPermutationSet {
    return item !== null && typeof item === 'object' && 'generator' in item && 'permutationsCount' in item;
}

type RunBacktestCommonParams = {
    strategies: StrategyExecutionItem[];
};

export type RunBacktestFromRunConfigParams = RunBacktestCommonParams & {
    backtestRun: ProtoBacktestRun;
    backtest: Backtest;
};

export type RunBacktestParams =
    | ((
          | {
                backtest: Backtest;
            }
          | {
                backtestConfig: BacktestConfig;
            }
      ) &
          RunBacktestCommonParams)
    | RunBacktestFromRunConfigParams;
