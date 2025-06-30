import { BuyPredictionStrategyConfig } from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import { PricePredictionStrategyConfig } from '@src/trading/strategies/launchpads/PricePredictionStrategy';
import { PredictionSource } from '@src/trading/strategies/types';

export type LoggerType = 'silent' | 'normal';

export type StrategyFileConfig = { type: string; logger?: LoggerType } & (
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
);
