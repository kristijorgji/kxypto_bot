import { Logger } from 'winston';

import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { deepClone } from '../../../utils/data/data';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import { StrategyConfig, StrategySellConfig } from '../types';

type StupidSniperStrategyConfig = StrategyConfig<{ sell: StrategySellConfig }>;

export default class StupidSniperStrategy extends LimitsBasedStrategy {
    readonly name = 'StupidSniperStrategy';

    readonly description = `
        The StupidSniperStrategy buys a newly launched token from the start. 
        Once a position is acquired, it employs the following exit strategies:
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    static readonly defaultConfig: StupidSniperStrategyConfig = {
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

    readonly config: StupidSniperStrategyConfig = deepClone(StupidSniperStrategy.defaultConfig);

    constructor(
        readonly logger: Logger,
        config?: Partial<StupidSniperStrategyConfig>,
    ) {
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

    async shouldBuy(): Promise<ShouldBuyResponse> {
        return {
            buy: true,
            reason: 'always',
        };
    }
}
