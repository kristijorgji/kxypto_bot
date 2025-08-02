import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';
import { z } from 'zod';

import { deepClone } from '@src/utils/data/data';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse } from '../../bots/types';
import {
    PredictionSource,
    PredictionStrategyShouldBuyResponseReason,
    marketContextIntervalConfigSchema,
    strategyConfigSchema,
    strategyPredictionConfigSchema,
    strategySellConfigSchema,
} from '../types';
import { shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import { ShouldBuyParams, formBaseCacheKey, shouldBuyWithBuyPrediction } from './prediction-common';
import { validatePredictionConfig } from './validators';
import { variantFromBuyContext, variantFromPredictionConfig, variantFromSellConfig } from './variant-builder';
import { HistoryRef } from '../../bots/blockchains/solana/types';

export const buyPredictionStrategyConfigSchema = strategyConfigSchema.merge(
    z.object({
        prediction: strategyPredictionConfigSchema,
        buy: z.object({
            minPredictedConfidence: z.number().positive(),
            minConsecutivePredictionConfirmations: z.number().positive().optional(),
            context: marketContextIntervalConfigSchema.optional(),
        }),
        sell: strategySellConfigSchema,
    }),
);
export type BuyPredictionStrategyConfig = z.infer<typeof buyPredictionStrategyConfigSchema>;

export type BuyPredictionStrategyShouldBuyResponseReason =
    | PredictionStrategyShouldBuyResponseReason
    | 'minPredictedBuyConfidence';

const CacheDefaultTtlSeconds = 3600 * 24 * 7;

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
            cache: {
                enabled: false,
            },
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

    private readonly shouldBuyCommonParams: ShouldBuyParams;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        private readonly source: PredictionSource,
        config?: Partial<BuyPredictionStrategyConfig>,
    ) {
        super(logger);
        const that = this;
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

        this.cacheBaseKey = formBaseCacheKey('buy', this.config.prediction, this.source);

        this.shouldBuyCommonParams = {
            deps: {
                logger: this.logger,
                client: this.client,
                cache: this.cache,
            },
            source: this.source,
            config: {
                prediction: this.config.prediction,
                buy: this.config.buy,
            },

            cacheBaseKey: this.cacheBaseKey,
            cacheDefaultTtlSeconds: CacheDefaultTtlSeconds,
            get consecutivePredictionConfirmations() {
                return that.consecutivePredictionConfirmations;
            },
            setConsecutivePredictionConfirmations: (value: number): number => {
                that.consecutivePredictionConfirmations = value;
                return this.consecutivePredictionConfirmations;
            },
        };
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
        return await shouldBuyWithBuyPrediction(this.shouldBuyCommonParams, mint, historyRef, context, history);
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
}
