import { z } from 'zod';

import { Backtest } from '@src/db/types';
import { loggerTypeSchema, strategyFileConfigSchema } from '@src/trading/config/types';

import { BacktestRunConfig, backtestRunConfigSchema } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

export const backtestFileConfigSchema = z
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
                runConfig: backtestRunConfigSchema,
            }),
        ]),
    );
export type BacktestFileConfig = z.infer<typeof backtestFileConfigSchema>;

export type BacktestConfig = (
    | {
          backtest: Backtest;
      }
    | {
          runConfig: BacktestRunConfig;
      }
) & {
    strategies: LaunchpadBotStrategy[];
};
