import { Backtest } from '../../db/types';
import { BacktestRunConfig } from '../bots/blockchains/solana/types';
import { BuyPredictionStrategyConfig } from '../strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';
import { PricePredictionStrategyConfig } from '../strategies/launchpads/PricePredictionStrategy';
import { PredictionSource } from '../strategies/types';

type LoggerType = 'silent' | 'normal';

type BacktestStrategiesFileConfig = ({ type: string; logger?: LoggerType } & (
    | {
          type: 'BuyPredictionStrategy';
          source: PredictionSource;
          config: Partial<BuyPredictionStrategyConfig>;
      }
    | {
          type: 'PricePredictionStrategy';
          source: PredictionSource;
          config: Partial<PricePredictionStrategyConfig>;
      }
))[];

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
