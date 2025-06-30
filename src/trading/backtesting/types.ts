import { Backtest } from '@src/db/types';
import { LoggerType, StrategyFileConfig } from '@src/trading/config/types';

import { BacktestRunConfig } from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

type BacktestStrategiesFileConfig = StrategyFileConfig[];

export type BacktestFileConfig = (
    | {
          backtestId: string;
      }
    | {
          runConfig: BacktestRunConfig;
      }
) & {
    strategyLogger?: LoggerType;
    strategies: BacktestStrategiesFileConfig;
};

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
