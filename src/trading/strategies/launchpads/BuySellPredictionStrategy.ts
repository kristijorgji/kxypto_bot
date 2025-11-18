import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';
import { z } from 'zod';

import {
    BuyPredictionStrategyShouldBuyResponseReason,
    buyConfigSchema,
} from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import DownsidePredictor from '@src/trading/strategies/predictors/DownsidePredictor';
import { deepClone } from '@src/utils/data/data';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import {
    HistoryRef,
    SellReason,
    ShouldBuyResponse,
    ShouldExitMonitoringResponse,
    ShouldSellResponse,
} from '../../bots/types';
import {
    PredictionSource,
    PredictionStrategyShouldSellResponseReason,
    isSingleSource,
    predictionConfigSchema,
    predictionSourceSchema,
    strategyConfigSchema,
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
import {
    variantFromBuyConfig,
    variantFromPredictionConfig,
    variantFromPredictionSource,
    variantFromSellContext,
} from './variant-builder';

const predictionProviderSchema = z.object({
    source: predictionSourceSchema,
    config: predictionConfigSchema,
});

export const buySellPredictionStrategyConfigSchema = strategyConfigSchema.merge(
    z.object({
        prediction: z.object({
            buy: predictionProviderSchema,
            sell: predictionProviderSchema,
        }),
        buy: buyConfigSchema,
        sell: strategySellConfigSchema.merge(
            z.object({
                minPredictedConfidence: z.number().positive(),
                minConsecutivePredictionConfirmations: z.number().positive().optional(),
            }),
        ),
    }),
);
export type BuySellPredictionStrategyConfig = z.infer<typeof buySellPredictionStrategyConfigSchema>;

export type BuySellPredictionStrategyConfigInput = Partial<BuySellPredictionStrategyConfig> &
    Pick<BuySellPredictionStrategyConfig, 'prediction'>;

export type BuySellPredictionStrategyShouldSellResponseReason = PredictionStrategyShouldSellResponseReason | SellReason;

const CacheDefaultTtlSeconds = 3600 * 24 * 14;

export default class BuySellPredictionStrategy extends LimitsBasedStrategy {
    readonly name = 'BuySellPredictionStrategy';

    readonly description = `
        The BuySellPredictionStrategy buys a token only when the service returns buy confidence higher than the required threshold. 
        Once a position is acquired, it employs the following exit strategies:
        - Sell when the predicted price is going to be lowered
        - Take profit when the price reaches a certain target.
        - Use trailing stop loss to lock in profits while allowing for continued growth.
    `;

    static readonly defaultConfig: Omit<BuySellPredictionStrategyConfig, 'prediction'> = {
        maxWaitMs: 5 * 60 * 1e3,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        buy: {
            minPredictedConfidence: 0.5,
        },
        sell: {
            minPredictedConfidence: 0.5,
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    };

    readonly config!: BuySellPredictionStrategyConfig;

    private readonly buyClient: RateLimitedAxiosInstance;
    private readonly sellClient: RateLimitedAxiosInstance;

    private readonly buyCacheBaseKey: string | string[];
    private readonly sellCacheBaseKey: string | string[];

    private consecutiveBuyPredictionConfirmations: number = 0;
    private consecutiveSellPredictionConfirmations: number = 0;

    private readonly shouldBuyCommonParams: ShouldBuyParams;
    private readonly shouldSellCommonParams: ShouldSellParams;

    constructor(
        readonly logger: Logger,
        private readonly cache: Redis,
        config: BuySellPredictionStrategyConfigInput,
    ) {
        super(logger);
        const that = this;

        this.config = {
            ...deepClone(BuySellPredictionStrategy.defaultConfig),
            ...config,
        };

        try {
            validatePredictionConfig(this.config.prediction.buy.config);
        } catch (e) {
            throw new Error(`config.prediction.buy.config: ${(e as Error).message}`);
        }
        try {
            validatePredictionConfig(this.config.prediction.sell.config);
        } catch (e) {
            throw new Error(`config.prediction.sell.config: ${(e as Error).message}`);
        }

        const buySource = this.config.prediction.buy.source;
        const sellSource = this.config.prediction.sell.source;

        if ((this.config?.variant ?? '') === '') {
            this.config.variant = BuySellPredictionStrategy.formVariant(buySource, sellSource, this.config);
        }

        const buySourcesCount = isSingleSource(buySource) ? 1 : buySource.sources.length;
        const sellSourcesCount = isSingleSource(sellSource) ? 1 : sellSource.sources.length;

        this.buyClient = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000 * buySourcesCount, perMilliseconds: 1000 },
        );
        this.sellClient = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000 * sellSourcesCount, perMilliseconds: 1000 },
        );

        if (isSingleSource(buySource)) {
            this.buyCacheBaseKey = formBaseCacheKey('buy', this.config.prediction.buy.config, buySource);
        } else {
            this.buyCacheBaseKey = buySource.sources.map(el =>
                formBaseCacheKey('buy', this.config.prediction.buy.config, el),
            );
        }
        if (isSingleSource(sellSource)) {
            this.sellCacheBaseKey = formBaseCacheKey('sell', this.config.prediction.sell.config, sellSource);
        } else {
            this.sellCacheBaseKey = sellSource.sources.map(el =>
                formBaseCacheKey('sell', this.config.prediction.sell.config, el),
            );
        }

        this.shouldBuyCommonParams = {
            deps: {
                logger: this.logger,
                client: this.buyClient,
                cache: this.cache,
                downsidePredictor: this.config.buy.downsideProtection
                    ? new DownsidePredictor(
                          this.logger,
                          this.cache,
                          this.config.buy.downsideProtection.source,
                          this.config.buy.downsideProtection,
                      )
                    : undefined,
            },
            source: buySource,
            config: {
                prediction: this.config.prediction.buy.config,
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
            source: sellSource,
            config: {
                prediction: this.config.prediction.sell.config,
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
        let r = `bp(${variantFromPredictionSource(buySource)}_bp(${variantFromPredictionConfig(config.prediction.buy.config)}))`;
        r += `_sp(${variantFromPredictionSource(sellSource)}_sp(${variantFromPredictionConfig(config.prediction.sell.config)}))`;
        r += `_${variantFromBuyConfig(config.buy)}`;
        r += `_sell(mpc:${config.sell.minPredictedConfidence}`;
        if (
            config.sell.minConsecutivePredictionConfirmations &&
            config.sell.minConsecutivePredictionConfirmations !== 1
        ) {
            r += `_mcpc:${config.sell.minConsecutivePredictionConfirmations}`;
        }
        r += `_l(${variantFromSellContext({
            trailingStopLossPercentage: config.sell.trailingStopLossPercentage,
            stopLossPercentage: config.sell.stopLossPercentage,
            takeProfitPercentage: config.sell.takeProfitPercentage,
            trailingTakeProfit: config.sell.trailingTakeProfit,
        })}))`;

        return r;
    }
}
