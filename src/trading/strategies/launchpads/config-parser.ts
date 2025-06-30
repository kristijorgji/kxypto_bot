import { Logger } from 'winston';

import { redis } from '@src/cache/cache';
import { logger, silentLogger } from '@src/logger';
import { StrategyFileConfig } from '@src/trading/config/types';
import BuyPredictionStrategy from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '@src/trading/strategies/launchpads/LaunchpadBotStrategy';
import PricePredictionStrategy from '@src/trading/strategies/launchpads/PricePredictionStrategy';

export function strategyFromConfig(sc: StrategyFileConfig, defaultStrategyLogger: Logger): LaunchpadBotStrategy {
    const strategyLogger = sc?.logger ? (sc.logger === 'silent' ? silentLogger : logger) : defaultStrategyLogger;
    const type = sc.type;

    switch (type) {
        case 'BuyPredictionStrategy':
            return new BuyPredictionStrategy(strategyLogger, redis, sc.source, sc.config);
        case 'PricePredictionStrategy':
            return new PricePredictionStrategy(strategyLogger, redis, sc.source, sc.config);
        default:
            throw new Error(`Unknown strategy type ${type}`);
    }
}
