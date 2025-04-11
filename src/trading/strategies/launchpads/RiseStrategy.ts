import { Logger } from 'winston';

import { shouldBuyStateless, shouldExitLaunchpadToken } from './common';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import { LaunchpadStrategyBuyConfig, StrategyConfig, StrategySellConfig } from '../types';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';

export type RiseStrategyConfig = StrategyConfig<{ buy: LaunchpadStrategyBuyConfig; sell: StrategySellConfig }>;

export default class RiseStrategy extends LimitsBasedStrategy {
    readonly name = 'RiseStrategy';

    readonly description = `
        The RiseStrategy monitors a newly launched token from the start, waiting for growth before buying. 
        Once a position is acquired, it employs the following exit strategies:
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    readonly config: RiseStrategyConfig = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        buy: {
            holdersCount: {
                min: 15,
            },
            bondingCurveProgress: {
                min: 25,
            },
            devHoldingPercentage: {
                max: 10,
            },
            topTenHoldingPercentage: {
                max: 35,
            },
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    constructor(readonly logger: Logger, config?: Partial<RiseStrategyConfig>) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }
    }

    shouldExit(
        marketContext: MarketContext,
        history: HistoryEntry[],
        extra: {
            elapsedMonitoringMs: number;
        },
    ): ShouldExitMonitoringResponse {
        return shouldExitLaunchpadToken(marketContext, history, extra, this._buyPosition, this.config.maxWaitMs);
    }

    shouldBuy(mint: string, marketContext: MarketContext): Promise<boolean> {
        return Promise.resolve(shouldBuyStateless(this.config.buy, marketContext));
    }

    async shouldSell(mint: string, marketContext: MarketContext, history: HistoryEntry[]): Promise<ShouldSellResponse> {
        const shouldSellRes = await super.shouldSell(mint, marketContext, history);
        if (shouldSellRes) {
            return shouldSellRes;
        }

        const shouldSell = !shouldBuyStateless(this.config.buy, marketContext);
        if (!shouldSell) {
            return false;
        }

        return {
            reason: 'NO_LONGER_MEETS_ENTRY_RULES',
        };
    }
}
