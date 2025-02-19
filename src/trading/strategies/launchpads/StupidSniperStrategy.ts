import { Logger } from 'winston';

import { LaunchpadBotStrategy } from './LaunchpadBotStrategy';
import { TradeTransaction } from '../../bots/blockchains/solana/types';
import { MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import TakeProfitPercentage from '../../orders/TakeProfitPercentage';
import TrailingStopLoss from '../../orders/TrailingStopLoss';
import TrailingTakeProfit from '../../orders/TrailingTakeProfit';

export default class StupidSniperStrategy implements LaunchpadBotStrategy {
    readonly name = 'StupidSniperStrategy';

    readonly description = `
        The StupidSniperStrategy buys a newly launched token from the start. 
        Once a position is acquired, it employs the following exit strategies:
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    readonly config = {
        buyMonitorWaitPeriodMs: 500,
        sellMonitorWaitPeriodMs: 200,
        maxWaitMs: 4 * 60 * 1e3,
    };

    get buyPosition(): TradeTransaction | undefined {
        return this._buyPosition;
    }

    private trailingStopLoss: TrailingStopLoss | undefined;
    private takeProfit: TakeProfitPercentage | undefined;
    private trailingTakeProfit: TrailingTakeProfit | undefined;

    private _buyPosition: TradeTransaction | undefined;

    // eslint-disable-next-line no-useless-constructor
    constructor(readonly logger: Logger) {}

    shouldExit(): ShouldExitMonitoringResponse {
        return false;
    }

    shouldBuy(): boolean {
        return true;
    }

    afterBuy(buyPrice: number, buyPosition: TradeTransaction): void {
        this._buyPosition = buyPosition;
        this.trailingStopLoss = new TrailingStopLoss(buyPrice, 15);
        this.trailingTakeProfit = new TrailingTakeProfit({
            entryPrice: buyPrice,
            trailingProfitPercentage: 15,
            trailingStopPercentage: 10,
        });
    }

    shouldSell({ price }: MarketContext): ShouldSellResponse {
        let sell: ShouldSellResponse = false;

        if (this.takeProfit && this.takeProfit.updatePrice(price)) {
            sell = {
                reason: 'TAKE_PROFIT',
            };
            this.logger.info('Triggered take profit at price %s. %o', price, this.trailingTakeProfit);
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
