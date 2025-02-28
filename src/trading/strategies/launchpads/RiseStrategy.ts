import { Logger } from 'winston';

import { shouldBuyStateless } from './common';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse } from '../../bots/types';
import { LaunchpadStrategyBuyConfig, StrategyConfig, StrategySellConfig } from '../types';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';

type ConfigExtra = { buy: LaunchpadStrategyBuyConfig; sell: StrategySellConfig };

export default class RiseStrategy extends LimitsBasedStrategy {
    readonly name = 'RiseStrategy';

    readonly description = `
        The RiseStrategy monitors a newly launched token from the start, waiting for growth before buying. 
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

    constructor(readonly logger: Logger, config?: Partial<StrategyConfig<ConfigExtra>>) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }
    }

    shouldExit(
        { marketCap, holdersCount }: MarketContext,
        history: HistoryEntry[],
        {
            elapsedMonitoringMs,
        }: {
            elapsedMonitoringMs: number;
        },
    ): ShouldExitMonitoringResponse {
        const mcDiffFromInitialPercentage = ((marketCap - history[0].marketCap) / history[0].marketCap) * 100;

        let res: ShouldExitMonitoringResponse = false;

        if (
            mcDiffFromInitialPercentage < -6 ||
            (mcDiffFromInitialPercentage < -5 && holdersCount <= 3 && elapsedMonitoringMs >= 120 * 1e3)
        ) {
            const exitCode = 'DUMPED';

            if (this._buyPosition) {
                res = {
                    exitCode: exitCode,
                    message: 'The token is probably dumped and we will sell at loss, sell=true',
                    shouldSell: {
                        reason: exitCode,
                    },
                };
            } else {
                res = {
                    exitCode: exitCode,
                    message:
                        'Stopped monitoring token because it was probably dumped and current market cap is less than the initial one',
                    shouldSell: false,
                };
            }
        } else if (!this._buyPosition && elapsedMonitoringMs >= this.config.maxWaitMs) {
            res = {
                exitCode: 'NO_PUMP',
                message: `Stopped monitoring token. We waited ${elapsedMonitoringMs / 1000} seconds and did not pump`,
                shouldSell: false,
            };
        }

        return res;
    }

    shouldBuy(marketContext: MarketContext): boolean {
        return shouldBuyStateless(this.config.buy, marketContext);
    }
}
