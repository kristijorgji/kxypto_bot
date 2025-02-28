import { Logger } from 'winston';

import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { ShouldExitMonitoringResponse } from '../../bots/types';
import { StrategyConfig, StrategySellConfig } from '../types';

type ConfigExtra = {
    sell: StrategySellConfig;
};

export default class StupidSniperStrategy extends LimitsBasedStrategy {
    readonly name = 'StupidSniperStrategy';

    readonly description = `
        The StupidSniperStrategy buys a newly launched token from the start. 
        Once a position is acquired, it employs the following exit strategies:
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    readonly config: StrategyConfig<ConfigExtra> = {
        buyMonitorWaitPeriodMs: 500,
        sellMonitorWaitPeriodMs: 200,
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        sell: {
            trailingStopLossPercentage: 15,
            trailingTakeProfit: {
                profitPercentage: 15,
                stopPercentage: 10,
            },
        },
    };

    constructor(readonly logger: Logger, config?: Partial<StrategyConfig>) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }
    }

    shouldExit(): ShouldExitMonitoringResponse {
        return false;
    }

    shouldBuy(): boolean {
        return true;
    }
}
