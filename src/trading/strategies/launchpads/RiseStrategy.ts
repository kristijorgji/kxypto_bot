import { Logger } from 'winston';

import { TradeTransaction } from '../../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import TakeProfitPercentage from '../../orders/TakeProfitPercentage';
import TrailingStopLoss from '../../orders/TrailingStopLoss';
import TrailingTakeProfit from '../../orders/TrailingTakeProfit';
import { StrategyConfig } from '../types';
import LaunchpadBotStrategy from './LaunchpadBotStrategy';

export default class RiseStrategy extends LaunchpadBotStrategy {
    readonly name = 'RiseStrategy';

    readonly description = `
        The RiseStrategy monitors a newly launched token from the start, waiting for growth before buying. 
        Once a position is acquired, it employs the following exit strategies:
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    readonly config = {
        buyMonitorWaitPeriodMs: 500,
        sellMonitorWaitPeriodMs: 200,
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
    };

    get buyPosition(): TradeTransaction | undefined {
        return this._buyPosition;
    }

    private trailingStopLoss: TrailingStopLoss | undefined;
    private takeProfitPercentage: TakeProfitPercentage | undefined;
    private trailingTakeProfit: TrailingTakeProfit | undefined;

    private _buyPosition: TradeTransaction | undefined;

    constructor(readonly logger: Logger, config?: Partial<StrategyConfig>) {
        super();
        if (this.config) {
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

    shouldBuy({
        bondingCurveProgress,
        holdersCount,
        devHoldingPercentage,
        topTenHoldingPercentage,
    }: MarketContext): boolean {
        return (
            holdersCount >= 15 &&
            bondingCurveProgress >= 25 &&
            devHoldingPercentage <= 10 &&
            topTenHoldingPercentage <= 35
        );
    }

    afterBuy(buyPrice: number, buyPosition: TradeTransaction): void {
        this._buyPosition = buyPosition;
        this.trailingStopLoss = new TrailingStopLoss(buyPrice, 15);
        this.takeProfitPercentage = new TakeProfitPercentage(buyPrice, 15);
    }

    shouldSell({ price }: MarketContext): ShouldSellResponse {
        let sell: ShouldSellResponse = false;

        if (this.takeProfitPercentage && this.takeProfitPercentage.updatePrice(price)) {
            sell = {
                reason: 'TAKE_PROFIT',
            };
            this.logger.info('Triggered take profit at price %s. %o', price, this.takeProfitPercentage);
        } else if (this.trailingTakeProfit && this.trailingTakeProfit.updatePrice(price)) {
            sell = {
                reason: 'TRAILING_TAKE_PROFIT',
            };
            this.logger.info('Triggered trailing take profit at price %s. %o', price, this.trailingTakeProfit);
        } else if (!sell && this.trailingStopLoss!.updatePrice(price)) {
            sell = {
                reason: 'TRAILING_STOP_LOSS',
            };
            this.logger.info(
                'Triggered trailing stop loss at price %s with %s%% trailingPercentage and stopPrice %s',
                price,
                this.trailingStopLoss!.getTrailingPercentage(),
                this.trailingStopLoss!.getStopPrice(),
            );
        }

        return sell;
    }

    afterSell(): void {
        this._buyPosition = undefined;
    }

    resetState(): void {
        this._buyPosition = undefined;
    }
}
