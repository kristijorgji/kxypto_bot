import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import { Logger } from 'winston';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import { IntervalConfig, StrategyConfig, StrategySellConfig } from '../types';
import { shouldBuyStateless, shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { deepEqual } from '../../../utils/data/equals';

export type PredictionStrategyConfig = StrategyConfig<{
    /**
     * The number of most recent features that must be present for a prediction to proceed.
     */
    requiredFeaturesLength: number;

    /**
     * Optional upper limit on the number of features to consider for predictions.
     */
    upToFeaturesLength?: number;

    /**
     * Whether to skip predictions if all features are the same.
     * Useful to avoid redundant signals when data has no variation.
     */
    skipAllSameFeatures: boolean;

    buy: {
        minPredictedPriceIncreasePercentage: number;
        minConsecutivePredictionConfirmations?: number;
        context?: Partial<Record<keyof MarketContext, IntervalConfig>>;
    };
    sell: StrategySellConfig;
}>;

export type PredictPricesRequest = {
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
    variance_prices?: number[];
};

export type PredictionStrategyShouldBuyResponseReason =
    | 'requiredFeaturesLength'
    | 'shouldBuyStateless'
    | 'noVariationInFeatures'
    | 'consecutivePredictionConfirmations'
    | 'minPredictedPriceIncreasePercentage'
    | 'prediction_error';

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
        skipAllSameFeatures: true,
        buy: {
            minPredictedPriceIncreasePercentage: 15,
            minConsecutivePredictionConfirmations: 1,
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    private readonly client: RateLimitedAxiosInstance;

    private consecutivePredictionConfirmations: number = 0;

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
            { maxRequests: 8000, perMilliseconds: 1000 },
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

    async shouldBuy(
        mint: string,
        context: MarketContext,
        history: HistoryEntry[],
    ): Promise<ShouldBuyResponse<PredictionStrategyShouldBuyResponseReason>> {
        if (history.length < this.config.requiredFeaturesLength) {
            return {
                buy: false,
                reason: 'requiredFeaturesLength',
            };
        }

        if (this.config.buy.context && !shouldBuyStateless(this.config.buy.context, context)) {
            return {
                buy: false,
                reason: 'shouldBuyStateless',
            };
        }

        const featuresCountToSend = this.config.upToFeaturesLength
            ? Math.min(history.length, this.config.upToFeaturesLength)
            : this.config.requiredFeaturesLength;

        const requestBody: PredictPricesRequest = {
            mint: mint,
            features: history.slice(-featuresCountToSend).map(e => ({
                timestamp: e.timestamp,
                price: e.price,
                marketCap: e.marketCap,
                bondingCurveProgress: e.bondingCurveProgress,
                holdersCount: e.holdersCount,
                devHoldingPercentage: e.devHoldingPercentage,
                topTenHoldingPercentage: e.topTenHoldingPercentage,
            })),
        };

        // because the scaler will use 0 value if all features are exactly same objects, while excluding the timestamp that always changes
        if (this.config.skipAllSameFeatures) {
            let areSame = true;
            for (let i = 1; i < requestBody.features.length; i++) {
                const features = requestBody.features[i];

                if (!deepEqual(features, requestBody.features[i - 1], new Set(['timestamp']))) {
                    areSame = false;
                    break;
                }
            }

            if (areSame) {
                this.logger.debug(
                    'There is no variation in the %d features, returning false',
                    requestBody.features.length,
                );
                return {
                    buy: false,
                    reason: 'noVariationInFeatures',
                };
            }
        }

        const response = await this.client.post<PredictPricesResponse>(this.source.endpoint, requestBody);

        if (response.status === 200) {
            const nextPrices = (response.data as PredictPricesResponse).predicted_prices;
            const lastNextPrice = nextPrices[nextPrices.length - 1];
            const nextVariances = (response.data as PredictPricesResponse)?.variance_prices ?? [null];
            const lastNextVariance = nextVariances[nextVariances.length - 1];

            const responseData = {
                lastNextPrice: lastNextPrice,
                lastNextVariance: lastNextVariance,
            };

            const increasePercentage = ((lastNextPrice - context.price) / context.price) * 100;
            if (increasePercentage >= this.config.buy.minPredictedPriceIncreasePercentage) {
                this.consecutivePredictionConfirmations++;

                return {
                    buy:
                        this.consecutivePredictionConfirmations >=
                        (this.config.buy?.minConsecutivePredictionConfirmations ?? 1),
                    reason: 'consecutivePredictionConfirmations',
                    data: responseData,
                };
            } else {
                this.consecutivePredictionConfirmations = 0;

                return {
                    buy: false,
                    reason: 'minPredictedPriceIncreasePercentage',
                    data: responseData,
                };
            }
        } else {
            this.logger.error('Error getting price prediction for mint %s, returning false', mint);
            this.logger.error(response);
        }

        return {
            buy: false,
            reason: 'prediction_error',
            data: {
                response: {
                    status: response.status,
                    body: response.data,
                },
            },
        };
    }

    resetState() {
        super.resetState();
        this.consecutivePredictionConfirmations = 0;
    }
}
