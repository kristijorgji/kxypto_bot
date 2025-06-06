import axios, { AxiosResponse } from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import {
    IntervalConfig,
    PredictionRequest,
    PredictionSource,
    PredictionStrategyShouldBuyResponseReason,
    StrategyConfig,
    StrategyPredictionConfig,
    StrategySellConfig,
} from '../types';
import { shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { shouldBuyCommon } from './prediction-common';
import { validatePredictionConfig } from './validators';
import { variantFromBuyContext, variantFromPredictionConfig, variantFromSellConfig } from './variant-builder';
import { deepClone } from '../../../utils/data/data';
import { HistoryRef } from '../../bots/blockchains/solana/types';

export type BuyPredictionStrategyConfig = StrategyConfig<{
    prediction: StrategyPredictionConfig;
    buy: {
        minPredictedConfidence: number;
        minConsecutivePredictionConfirmations?: number;
        context?: Partial<Record<keyof MarketContext, IntervalConfig>>;
    };
    sell: StrategySellConfig;
}>;

type BuyPredictionResponse = {
    /**
     * Confidence score of the buy prediction, ranging from 0 (no confidence)
     * to 1 (full confidence). Represents the model's certainty that the asset
     * is a good buy.
     */
    confidence: number;
};

export type BuyPredictionStrategyShouldBuyResponseReason =
    | PredictionStrategyShouldBuyResponseReason
    | 'minPredictedBuyConfidence';

export default class BuyPredictionStrategy extends LimitsBasedStrategy {
    readonly name = 'BuyPredictionStrategy';

    readonly description = `
        The BuyPredictionStrategy buys a token only when the service returns buy confidence higher than the required threshold. 
        Once a position is acquired, it employs the following exit strategies:
        - Sell when the predicted price is going to be lowered
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    static readonly defaultConfig: BuyPredictionStrategyConfig = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        prediction: {
            requiredFeaturesLength: 10,
            skipAllSameFeatures: true,
        },
        buy: {
            minPredictedConfidence: 0.5,
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    readonly config: BuyPredictionStrategyConfig = deepClone(BuyPredictionStrategy.defaultConfig);

    private readonly client: RateLimitedAxiosInstance;

    private readonly cacheBaseKey: string;

    private consecutivePredictionConfirmations: number = 0;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        private readonly source: PredictionSource,
        config?: Partial<BuyPredictionStrategyConfig>,
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
            this.config.variant = BuyPredictionStrategy.formVariant(source, this.config);
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
    ): Promise<ShouldBuyResponse<BuyPredictionStrategyShouldBuyResponseReason>> {
        const r = await shouldBuyCommon(this.logger, mint, historyRef, context, history, this.config);
        if ((r as ShouldBuyResponse)?.reason) {
            return r as ShouldBuyResponse<BuyPredictionStrategyShouldBuyResponseReason>;
        }

        let predictionResponse: AxiosResponse | undefined;
        let prediction: BuyPredictionResponse | undefined;

        const cacheKey = `${this.cacheBaseKey}_${mint}_${historyRef.index}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            prediction = JSON.parse(cached);
        } else {
            predictionResponse = await this.client.post<BuyPredictionResponse>(
                this.source.endpoint,
                r as PredictionRequest,
            );
            if (predictionResponse.status === 200) {
                if (predictionResponse.data.confidence === undefined) {
                    throw new Error(
                        `The response is missing the required field confidence. ${JSON.stringify(predictionResponse.data)}`,
                    );
                } else if (predictionResponse.data.confidence < 0 || predictionResponse.data.confidence > 1) {
                    throw new Error(
                        `Expected confidence to be in the interval [0, 1], but got ${predictionResponse.data.confidence}`,
                    );
                } else {
                    prediction = predictionResponse.data as BuyPredictionResponse;
                    this.cache.set(cacheKey, JSON.stringify(prediction), 'EX', 3600 * 24 * 7);
                }
            } else {
                this.logger.error('Error getting buy prediction for mint %s, returning false', mint);
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

        const responseData = {
            predictedBuyConfidence: prediction.confidence,
        };

        if (prediction.confidence >= this.config.buy.minPredictedConfidence) {
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
                reason: 'minPredictedBuyConfidence',
                data: responseData,
            };
        }
    }

    resetState() {
        super.resetState();
        this.consecutivePredictionConfirmations = 0;
    }

    public static formVariant(source: PredictionSource, config: BuyPredictionStrategyConfig): string {
        let r = `${source.model}_p(${variantFromPredictionConfig(config.prediction)})`;

        r += `_buy(mpc:${config.buy.minPredictedConfidence}`;
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
        const pc = variantFromPredictionConfig(this.config.prediction);
        return `bp.${this.source.model}${pc.length === 0 ? '' : `_${pc}`}`;
    }
}
