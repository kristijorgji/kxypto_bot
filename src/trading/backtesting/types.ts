import { z } from 'zod';

import { Backtest } from '@src/db/types';
import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { RunStrategyConfig } from '@src/trading/backtesting/runStrategy';
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
    logging?: {
        runStrategy?: RunStrategyConfig['logging'];
    };
    storage?: {
        /**
         * 'all': Store every result.
         * 'best_only': Only update the DB if the current PnL is higher than previous runs.
         */
        strategyPersistence?: 'all' | 'best_only';

        /** Toggle for detailed per-mint data */
        storeMintResults?: boolean;
    };
    pubsub?: {
        /** Broadcast high-level backtest run creation/completion/updates */
        notifyRunUpdate?: boolean;

        /** Broadcast high-level strategy creation/ompletion/updates */
        notifyStrategyUpdate?: boolean;

        /** * Broadcast individual mint completions.
         * Warning: High frequency can flood WebSockets.
         */
        notifyMintResults?: boolean;
    };
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
