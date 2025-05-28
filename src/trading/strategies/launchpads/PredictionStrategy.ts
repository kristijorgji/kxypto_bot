import axios, { AxiosResponse } from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import { IntervalConfig, StrategyConfig, StrategySellConfig } from '../types';
import { shouldBuyStateless, shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { variantFromBuyContext, variantFromSellConfig } from './variant-builder';
import {deepClone} from '../../../utils/data/data';
import { deepEqual } from '../../../utils/data/equals';
import { HistoryRef } from '../../bots/blockchains/solana/types';

export type PredictionSource = {
    endpoint: string;
    /**
     * The model of the prediction, example: 'v1_rsi7_macd5'
     */
    model: string;
};

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
        timeFromStartMs: number;
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

    static readonly defaultConfig: PredictionStrategyConfig = {
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
    }

    readonly config: PredictionStrategyConfig = deepClone(PredictionStrategy.defaultConfig);

    private readonly client: RateLimitedAxiosInstance;

    private readonly cacheBaseKey: string;

    private consecutivePredictionConfirmations: number = 0;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        private readonly source: PredictionSource,
        config?: Partial<PredictionStrategyConfig>,
    ) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }

        if ((this.config?.variant ?? '') === '') {
            this.config.variant = PredictionStrategy.formVariant(source, this.config);
        }

        this.client = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000, perMilliseconds: 1000 },
        );

        this.cacheBaseKey = this.formBaseCacheKey();
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
        historyRef: HistoryRef,
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
            features: history.slice(-featuresCountToSend).map(
                e =>
                    ({
                        timestamp: e.timestamp,
                        timeFromStartMs: e.timestamp - history[0].timestamp,
                        price: e.price,
                        marketCap: e.marketCap,
                        bondingCurveProgress: e.bondingCurveProgress,
                        holdersCount: e.holdersCount,
                        devHoldingPercentage: e.devHoldingPercentage,
                        topTenHoldingPercentage: e.topTenHoldingPercentage,
                        // eslint-disable-next-line prettier/prettier
            } satisfies PredictPricesRequest['features'][number])),
        };

        // because the scaler will use 0 value if all features are exactly same objects, while excluding the timestamp that always changes
        if (this.config.skipAllSameFeatures) {
            let areSame = true;
            for (let i = 1; i < requestBody.features.length; i++) {
                const features = requestBody.features[i];

                if (!deepEqual(features, requestBody.features[i - 1], new Set(['timestamp', 'timeFromStartMs']))) {
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

        let predictionResponse: AxiosResponse | undefined;
        let prediction: PredictPricesResponse | undefined;

        const cacheKey = `${this.cacheBaseKey}_${mint}_${historyRef.index}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            prediction = JSON.parse(cached);
        } else {
            predictionResponse = await this.client.post<PredictPricesResponse>(this.source.endpoint, requestBody);
            if (predictionResponse.status === 200) {
                prediction = predictionResponse.data as PredictPricesResponse;
                this.cache.set(cacheKey, JSON.stringify(prediction), 'EX', 3600 * 24 * 7);
            } else {
                this.logger.error('Error getting price prediction for mint %s, returning false', mint);
                this.logger.error(predictionResponse);
            }
        }

        if (!prediction) {
            return {
                buy: false,
                reason: 'prediction_error',
                data: {
                    response: {
                        status: predictionResponse!.status,
                        body: predictionResponse!.data,
                    },
                },
            };
        }

        const nextPrices = prediction.predicted_prices;
        const lastNextPrice = nextPrices[nextPrices.length - 1];
        const nextVariances = prediction?.variance_prices ?? [null];
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
    }

    resetState() {
        super.resetState();
        this.consecutivePredictionConfirmations = 0;
    }

    public static formVariant(source: PredictionSource, config: PredictionStrategyConfig): string {
        let r = `${source.model}_b(`;

        const parts: Record<string, string | undefined | boolean | number> = {
            skf: config.skipAllSameFeatures,
            rql: config.requiredFeaturesLength,
            upfl: config.upToFeaturesLength,
        };

        let first = true;
        for (const key in parts) {
            const val = parts[key];
            if (val === undefined) {
                continue;
            }

            r = `${r}${first ? '' : '_'}${key}:${val?.toString()}`;
            first = false;
        }

        r += `)_buy(mppip:${config.buy.minPredictedPriceIncreasePercentage}`;
        if (
            config.buy.minConsecutivePredictionConfirmations &&
            config.buy.minConsecutivePredictionConfirmations !== 1
        ) {
            r += `_mcpc:${config.buy.minConsecutivePredictionConfirmations}`;
        }

        if (config.buy.context) {
            r += `_c(${variantFromBuyContext(config.buy.context)})`;
        }
        r += `)_sell(${variantFromSellConfig(config.sell)})`;

        return r;
    }

    private formBaseCacheKey(): string {
        const partsOfCacheKey: Record<string, string | undefined | boolean | number> = {
            skf: this.config.skipAllSameFeatures,
            rql: this.config.requiredFeaturesLength,
            upfl: this.config.upToFeaturesLength,
        };

        let r = `p.${this.source.model}`;

        for (const key in partsOfCacheKey) {
            const val = partsOfCacheKey[key];
            if (val === undefined) {
                continue;
            }

            r = `${r}_${key}:${val?.toString()}`;
        }

        return r;
    }
}
