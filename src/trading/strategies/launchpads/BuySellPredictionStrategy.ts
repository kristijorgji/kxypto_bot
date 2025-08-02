import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';
import { z } from 'zod';

import { BuyPredictionStrategyShouldBuyResponseReason } from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import { deepClone } from '@src/utils/data/data';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { SellReason, ShouldBuyResponse, ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import {
    PredictionSource,
    PredictionStrategyShouldSellResponseReason,
    marketContextIntervalConfigSchema,
    strategyConfigSchema,
    strategyPredictionConfigSchema,
    strategySellConfigSchema,
} from '../types';
import { shouldExitLaunchpadToken } from './common';
import { LimitsBasedStrategy } from './LimitsBasedStrategy';
import {
    ShouldBuyParams,
    ShouldSellParams,
    formBaseCacheKey,
    shouldBuyWithBuyPrediction,
    shouldSellPredicted,
} from './prediction-common';
import { validatePredictionConfig } from './validators';
import { variantFromBuyContext, variantFromPredictionConfig, variantFromSellConfig } from './variant-builder';
import { HistoryRef } from '../../bots/blockchains/solana/types';

export const buySellPredictionStrategyConfigSchema = strategyConfigSchema.merge(
    z.object({
        prediction: z.object({
            buy: strategyPredictionConfigSchema,
            sell: strategyPredictionConfigSchema,
        }),
        buy: z.object({
            minPredictedConfidence: z.number().positive(),
            minConsecutivePredictionConfirmations: z.number().positive().optional(),
            context: marketContextIntervalConfigSchema.optional(),
        }),
        sell: strategySellConfigSchema.merge(
            z.object({
                minPredictedConfidence: z.number().positive(),
                minConsecutivePredictionConfirmations: z.number().positive().optional(),
            }),
        ),
    }),
);
export type BuySellPredictionStrategyConfig = z.infer<typeof buySellPredictionStrategyConfigSchema>;

export type BuySellPredictionStrategyShouldSellResponseReason = PredictionStrategyShouldSellResponseReason | SellReason;

const CacheDefaultTtlSeconds = 3600 * 24 * 7;

export default class BuySellPredictionStrategy extends LimitsBasedStrategy {
    readonly name = 'BuySellPredictionStrategy';

    readonly description = `
        The BuySellPredictionStrategy buys a token only when the service returns buy confidence higher than the required threshold. 
        Once a position is acquired, it employs the following exit strategies:
        - Sell when the predicted price is going to be lowered
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    static readonly defaultConfig: BuySellPredictionStrategyConfig = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        prediction: {
            buy: {
                requiredFeaturesLength: 10,
                skipAllSameFeatures: true,
                cache: {
                    enabled: false,
                },
            },
            sell: {
                requiredFeaturesLength: 10,
                skipAllSameFeatures: true,
                cache: {
                    enabled: false,
                },
            },
        },
        buy: {
            minPredictedConfidence: 0.5,
        },
        sell: {
            minPredictedConfidence: 0.5,
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    readonly config: BuySellPredictionStrategyConfig = deepClone(BuySellPredictionStrategy.defaultConfig);

    private readonly buyClient: RateLimitedAxiosInstance;
    private readonly sellClient: RateLimitedAxiosInstance;

    private readonly buyCacheBaseKey: string;
    private readonly sellCacheBaseKey: string;

    private consecutiveBuyPredictionConfirmations: number = 0;
    private consecutiveSellPredictionConfirmations: number = 0;

    private readonly shouldBuyCommonParams: ShouldBuyParams;
    private readonly shouldSellCommonParams: ShouldSellParams;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        private readonly buySource: PredictionSource,
        private readonly sellSource: PredictionSource,
        config?: Partial<BuySellPredictionStrategyConfig>,
    ) {
        super(logger);
        const that = this;
        if (config) {
            this.config = {
                ...this.config,
                ...config,
            };
        }
        try {
            validatePredictionConfig(this.config.prediction.buy);
        } catch (e) {
            throw new Error(`config.prediction.buy: ${(e as Error).message}`);
        }
        try {
            validatePredictionConfig(this.config.prediction.sell);
        } catch (e) {
            throw new Error(`config.prediction.sell: ${(e as Error).message}`);
        }

        if ((this.config?.variant ?? '') === '') {
            this.config.variant = BuySellPredictionStrategy.formVariant(buySource, sellSource, this.config);
        }

        this.buyClient = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000, perMilliseconds: 1000 },
        );
        this.sellClient = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000, perMilliseconds: 1000 },
        );

        this.buyCacheBaseKey = formBaseCacheKey('buy', this.config.prediction.buy, this.buySource);
        this.sellCacheBaseKey = formBaseCacheKey('sell', this.config.prediction.sell, this.sellSource);

        this.shouldBuyCommonParams = {
            deps: {
                logger: this.logger,
                client: this.buyClient,
                cache: this.cache,
            },
            source: this.buySource,
            config: {
                prediction: this.config.prediction.buy,
                buy: this.config.buy,
            },
            cacheBaseKey: this.buyCacheBaseKey,
            cacheDefaultTtlSeconds: CacheDefaultTtlSeconds,
            get consecutivePredictionConfirmations() {
                return that.consecutiveBuyPredictionConfirmations;
            },
            setConsecutivePredictionConfirmations: (value: number): number => {
                that.consecutiveBuyPredictionConfirmations = value;
                return this.consecutiveBuyPredictionConfirmations;
            },
        };

        this.shouldSellCommonParams = {
            deps: {
                logger: this.logger,
                client: this.sellClient,
                cache: this.cache,
            },
            source: this.sellSource,
            config: {
                prediction: this.config.prediction.sell,
                sell: this.config.sell,
            },
            cacheBaseKey: this.sellCacheBaseKey,
            cacheDefaultTtlSeconds: CacheDefaultTtlSeconds,
            get consecutivePredictionConfirmations() {
                return that.consecutiveSellPredictionConfirmations;
            },
            setConsecutivePredictionConfirmations: (value: number): number => {
                that.consecutiveSellPredictionConfirmations = value;
                return this.consecutiveSellPredictionConfirmations;
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

    async shouldSell(
        mint: string,
        historyRef: HistoryRef,
        context: MarketContext,
        history: HistoryEntry[],
    ): Promise<ShouldSellResponse<BuySellPredictionStrategyShouldSellResponseReason>> {
        const res = await super.shouldSell(mint, historyRef, context, history);
        if (res.sell) {
            return res as ShouldSellResponse<SellReason | 'no_limit_matches'>;
        }

        return shouldSellPredicted(this.shouldSellCommonParams, mint, historyRef, context, history);
    }

    resetState() {
        super.resetState();
        this.consecutiveBuyPredictionConfirmations = 0;
        this.consecutiveSellPredictionConfirmations = 0;
    }

    public static formVariant(
        buySource: PredictionSource,
        sellSource: PredictionSource,
        config: BuySellPredictionStrategyConfig,
    ): string {
        let r = `${buySource.model}_bp(${variantFromPredictionConfig(config.prediction.buy)})_${sellSource.model}_sp(${variantFromPredictionConfig(config.prediction.sell)})`;

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

        r += `)_sell(mpc:${config.sell.minPredictedConfidence}`;
        if (
            config.sell.minConsecutivePredictionConfirmations &&
            config.sell.minConsecutivePredictionConfirmations !== 1
        ) {
            r += `_mcpc:${config.sell.minConsecutivePredictionConfirmations}`;
        }
        r += `_l(${variantFromSellConfig({
            trailingStopLossPercentage: config.sell.trailingStopLossPercentage,
            stopLossPercentage: config.sell.stopLossPercentage,
            takeProfitPercentage: config.sell.takeProfitPercentage,
            trailingTakeProfit: config.sell.trailingTakeProfit,
        })}))`;

        return r;
    }
}
