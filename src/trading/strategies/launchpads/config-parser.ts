import { Logger } from 'winston';

import { redis } from '@src/cache/cache';
import { logger, silentLogger } from '@src/logger';
import { StrategyFileConfig } from '@src/trading/config/types';
import BuyPredictionStrategy from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import BuySellPredictionStrategy from '@src/trading/strategies/launchpads/BuySellPredictionStrategy';
import LaunchpadBotStrategy from '@src/trading/strategies/launchpads/LaunchpadBotStrategy';
import PricePredictionStrategy from '@src/trading/strategies/launchpads/PricePredictionStrategy';
import RiseStrategy from '@src/trading/strategies/launchpads/RiseStrategy';
import StupidSniperStrategy from '@src/trading/strategies/launchpads/StupidSniperStrategy';
import { SinglePredictionSource } from '@src/trading/strategies/types';

export function strategyFromConfig(sc: StrategyFileConfig, defaultStrategyLogger: Logger): LaunchpadBotStrategy {
    const strategyLogger = sc?.logger ? (sc.logger === 'silent' ? silentLogger : logger) : defaultStrategyLogger;
    const type = sc.type;

    switch (type) {
        case 'StupidSniperStrategy':
            return new StupidSniperStrategy(strategyLogger, sc.config);
        case 'RiseStrategy':
            return new RiseStrategy(strategyLogger, sc.config);
        case 'BuyPredictionStrategy':
            return new BuyPredictionStrategy(strategyLogger, redis, sc.source, sc.config);
        case 'BuySellPredictionStrategy':
            return new BuySellPredictionStrategy(strategyLogger, redis, sc.buySource, sc.sellSource, sc.config);
        case 'PricePredictionStrategy':
            return new PricePredictionStrategy(strategyLogger, redis, sc.source as SinglePredictionSource, sc.config);
        default:
            throw new Error(`Unknown strategy type ${type}`);
    }
}
