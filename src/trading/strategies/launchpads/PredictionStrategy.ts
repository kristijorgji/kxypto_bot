import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import { Logger } from 'winston';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse } from '../../bots/types';
import { IntervalConfig, StrategyConfig, StrategySellConfig } from '../types';
import { shouldBuyStateless, shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';

export type PredictionStrategyConfig = StrategyConfig<{
    requiredFeaturesLength: number;
    buy: {
        minPredictedPriceIncreasePercentage: number;
        context?: Partial<Record<keyof MarketContext, IntervalConfig>>;
    };
    sell: StrategySellConfig;
}>;

type PredictPricesRequest = {
    mint: string;
    features: {
        timestamp: number;
        price: number;
        marketCap: number;
        bondingCurveProgress: number;
        holdersCount: number;
        devHoldingPercentage: number;
        topTenHoldingPercentage: number;
    }[];
};

type PredictPricesResponse = {
    predicted_prices: number[];
};

export default class PredictionStrategy extends LimitsBasedStrategy {
    readonly name = 'PredictionStrategy';

    readonly description = `
        The PredictionStrategy buys a token only when the predicted value in the future will be higher. 
        Once a position is acquired, it employs the following exit strategies:
        - Sell when the predicted price is going to be lowered
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    readonly config: PredictionStrategyConfig = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        requiredFeaturesLength: 10,
        buy: {
            minPredictedPriceIncreasePercentage: 15,
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    private readonly client: RateLimitedAxiosInstance;

    constructor(
        readonly logger: Logger,
        private readonly source: {
            endpoint: string;
        },
        config?: Partial<PredictionStrategyConfig>,
    ) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }

        this.client = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 6000, perMilliseconds: 1000 },
        );
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

    async shouldBuy(mint: string, context: MarketContext, history: HistoryEntry[]): Promise<boolean> {
        if (history.length < this.config.requiredFeaturesLength) {
            return false;
        }

        if (this.config.buy.context && !shouldBuyStateless(this.config.buy.context, context)) {
            return false;
        }

        const requestBody: PredictPricesRequest = {
            mint: mint,
            features: history.slice(-this.config.requiredFeaturesLength).map(e => ({
                timestamp: e.timestamp,
                price: e.price,
                marketCap: e.marketCap,
                bondingCurveProgress: e.bondingCurveProgress,
                holdersCount: e.holdersCount,
                devHoldingPercentage: e.devHoldingPercentage,
                topTenHoldingPercentage: e.topTenHoldingPercentage,
            })),
        };

        const response = await this.client.post<PredictPricesResponse>(this.source.endpoint, requestBody);

        if (response.status === 200) {
            const nextPrices = (response.data as PredictPricesResponse).predicted_prices;
            const lastNextPrice = nextPrices[nextPrices.length - 1];
            const increasePercentage = ((lastNextPrice - context.price) / context.price) * 100;
            if (increasePercentage >= this.config.buy.minPredictedPriceIncreasePercentage) {
                return true;
            }
        } else {
            this.logger.error('Error getting price prediction for mint %s, returning false', mint);
            this.logger.error(response);
        }

        return false;
    }
}
