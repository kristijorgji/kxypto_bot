import { z } from 'zod';

import { Backtest } from '@src/db/types';
import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { loggerTypeSchema, strategyFileConfigSchema } from '@src/trading/config/types';

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

type RunBacktestCommonParams = {
    strategies: LaunchpadBotStrategy[];
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
