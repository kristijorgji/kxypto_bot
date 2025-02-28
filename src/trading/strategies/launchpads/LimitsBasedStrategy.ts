import { Logger } from 'winston';

import LaunchpadBotStrategy from './LaunchpadBotStrategy';
import { TradeTransaction } from '../../bots/blockchains/solana/types';
import { MarketContext } from '../../bots/launchpads/types';
import { ShouldSellResponse } from '../../bots/types';
import StopLossPercentage from '../../orders/StopLossPercentage';
import TakeProfitPercentage from '../../orders/TakeProfitPercentage';
import TrailingStopLoss from '../../orders/TrailingStopLoss';
import TrailingTakeProfit from '../../orders/TrailingTakeProfit';
import { StrategyConfig, StrategySellConfig } from '../types';

type ConfigExtra = {
    sell: StrategySellConfig;
};

/**
 * A base strategy that supports trading standard limits for determining to sell or not
 */
export abstract class LimitsBasedStrategy extends LaunchpadBotStrategy {
    abstract config: StrategyConfig<ConfigExtra>;

    protected trailingStopLoss: TrailingStopLoss | undefined;
    protected stopLossPercentage: StopLossPercentage | undefined;
    protected takeProfitPercentage: TakeProfitPercentage | undefined;
    protected trailingTakeProfit: TrailingTakeProfit | undefined;

    protected _buyPosition: TradeTransaction | undefined;

    get buyPosition(): TradeTransaction | undefined {
        return this._buyPosition;
    }

    protected constructor(readonly logger: Logger) {
        super();
    }

    afterBuy(buyPrice: number, buyPosition: TradeTransaction): void {
        this._buyPosition = buyPosition;

        if (this.config.sell.trailingStopLossPercentage) {
            this.trailingStopLoss = new TrailingStopLoss(buyPrice, this.config.sell.trailingStopLossPercentage);
        }

        if (this.config.sell.stopLossPercentage) {
            this.stopLossPercentage = new StopLossPercentage(buyPrice, this.config.sell.stopLossPercentage);
        }

        if (this.config.sell.takeProfitPercentage) {
            this.takeProfitPercentage = new TakeProfitPercentage(buyPrice, this.config.sell.takeProfitPercentage);
        }

        if (this.config.sell.trailingTakeProfit) {
            this.trailingTakeProfit = new TrailingTakeProfit({
                entryPrice: buyPrice,
                trailingProfitPercentage: this.config.sell.trailingTakeProfit.profitPercentage,
                trailingStopPercentage: this.config.sell.trailingTakeProfit.stopPercentage,
            });
        }
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
        } else if (this.trailingStopLoss && this.trailingStopLoss!.updatePrice(price)) {
            sell = {
                reason: 'TRAILING_STOP_LOSS',
            };
            this.logger.info(
                'Triggered trailing stop loss at price %s with %s%% trailingPercentage and stopPrice %s',
                price,
                this.trailingStopLoss!.getTrailingPercentage(),
                this.trailingStopLoss!.getStopPrice(),
            );
        } else if (this.stopLossPercentage && this.stopLossPercentage!.updatePrice(price)) {
            sell = {
                reason: 'STOP_LOSS',
            };
            this.logger.info(
                'Triggered stop loss percentage at price %s with %s%% stopPercentage and stopPrice %s',
                price,
                this.stopLossPercentage!.stopPercentage,
                this.stopLossPercentage!.stopPrice,
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
