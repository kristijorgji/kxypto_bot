import axios, { AxiosResponse } from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';
import { z } from 'zod';

import { deepClone } from '@src/utils/data/data';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import {
    PredictionRequest,
    PredictionSource,
    PredictionStrategyShouldBuyResponseReason,
    marketContextIntervalConfigSchema,
    strategyConfigSchema,
    strategyPredictionConfigSchema,
    strategySellConfigSchema,
} from '../types';
import { shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { formBaseCacheKey, shouldBuyCommon } from './prediction-common';
import { validatePredictionConfig } from './validators';
import { variantFromBuyContext, variantFromPredictionConfig, variantFromSellConfig } from './variant-builder';
import { HistoryRef } from '../../bots/blockchains/solana/types';

export const pricePredictionStrategyConfigSchema = strategyConfigSchema.merge(
    z.object({
        prediction: strategyPredictionConfigSchema,
        buy: z.object({
            minPredictedPriceIncreasePercentage: z.number().positive(),
            minConsecutivePredictionConfirmations: z.number().positive().optional(),
            context: marketContextIntervalConfigSchema.optional(),
        }),
        sell: strategySellConfigSchema,
    }),
);
export type PricePredictionStrategyConfig = z.infer<typeof pricePredictionStrategyConfigSchema>;

type PredictPricesResponse = {
    predicted_prices: number[];
    variance_prices?: number[];
};

export type PricePredictionStrategyShouldBuyResponseReason =
    | PredictionStrategyShouldBuyResponseReason
    | 'minPredictedPriceIncreasePercentage';

const CacheDefaultTtlSeconds = 3600 * 24 * 7;

export default class PricePredictionStrategy extends LimitsBasedStrategy {
    readonly name = 'PricePredictionStrategy';

    readonly description = `
        The PricePredictionStrategy buys a token only when the predicted price in the future will be higher than the provided percentage. 
        Once a position is acquired, it employs the following exit strategies:
        - Sell when the predicted price is going to be lowered
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    static readonly defaultConfig: PricePredictionStrategyConfig = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        prediction: {
            requiredFeaturesLength: 10,
            skipAllSameFeatures: true,
            cache: {
                enabled: false,
            },
        },
        buy: {
            minPredictedPriceIncreasePercentage: 15,
            minConsecutivePredictionConfirmations: 1,
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    readonly config: PricePredictionStrategyConfig = deepClone(PricePredictionStrategy.defaultConfig);

    private readonly client: RateLimitedAxiosInstance;

    private readonly cacheBaseKey: string;

    private consecutivePredictionConfirmations: number = 0;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        private readonly source: PredictionSource,
        config?: Partial<PricePredictionStrategyConfig>,
    ) {
        super(logger);
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }
        validatePredictionConfig(this.config.prediction);

        if ((this.config?.variant ?? '') === '') {
            this.config.variant = PricePredictionStrategy.formVariant(source, this.config);
        }

        this.client = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000, perMilliseconds: 1000 },
        );

        this.cacheBaseKey = formBaseCacheKey('price', this.config.prediction, this.source);
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
    ): Promise<ShouldBuyResponse<PricePredictionStrategyShouldBuyResponseReason>> {
        const r = await shouldBuyCommon(this.logger, mint, historyRef, context, history, this.config);
        if ((r as ShouldBuyResponse)?.reason) {
            return r as ShouldBuyResponse<PricePredictionStrategyShouldBuyResponseReason>;
        }
        const predictionRequest = r as PredictionRequest;

        let predictionResponse: AxiosResponse | undefined;
        let prediction: PredictPricesResponse | undefined;

        let cacheKey: string | undefined;
        let cached;
        if (this.config.prediction.cache?.enabled) {
            cacheKey = `${this.cacheBaseKey}_${mint}_${historyRef.index}:${predictionRequest.features.length}`;
            cached = await this.cache.get(cacheKey);
        }

        if (cached) {
            prediction = JSON.parse(cached);
        } else {
            predictionResponse = await this.client.post<PredictPricesResponse>(this.source.endpoint, predictionRequest);
            if (predictionResponse.status === 200) {
                prediction = predictionResponse.data as PredictPricesResponse;
                if (this.config.prediction.cache?.enabled) {
                    this.cache.set(
                        cacheKey!,
                        JSON.stringify(prediction),
                        'EX',
                        this.config.prediction.cache.ttlSeconds ?? CacheDefaultTtlSeconds,
                    );
                }
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

    public static formVariant(source: PredictionSource, config: PricePredictionStrategyConfig): string {
        let r = `${source.model}_p(${variantFromPredictionConfig(config.prediction)})`;

        r += `_buy(mppip:${config.buy.minPredictedPriceIncreasePercentage}`;
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
}
