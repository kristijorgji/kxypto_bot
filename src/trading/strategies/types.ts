import { z } from 'zod';

import { HistoryRef } from '@src/trading/bots/types';

import { TradeTransaction } from '../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext, MarketContextKey, marketContextKeys } from '../bots/launchpads/types';

export const strategyConfigSchema = z.object({
    variant: z.string().optional(),
    /**
     * don't waste time on a token anymore if there is no increase until this time is reached
     */
    maxWaitMs: z.number().positive(),
    buySlippageDecimal: z.number().positive(),
    sellSlippageDecimal: z.number().positive(),
    priorityFeeInSol: z.number().positive().optional(),
    buyPriorityFeeInSol: z.number().positive().optional(),
    sellPriorityFeeInSol: z.number().positive().optional(),
});
export type StrategyConfig<C = Record<string, unknown>> = z.infer<typeof strategyConfigSchema> & C;

export const intervalConfigSchema = z
    .object({
        min: z.number().optional(),
        max: z.number().optional(),
    })
    .refine(data => data.min !== undefined || data.max !== undefined, {
        message: 'At least one of "min" or "max" must be provided',
        path: ['min'],
    });
export type IntervalConfig = z.infer<typeof intervalConfigSchema>;

export type LaunchpadBuyPosition = {
    marketContext: MarketContext;
    transaction: TradeTransaction;
};

export const singlePredictionSourceSchema = z.object({
    endpoint: z.string().url(),

    /**
     * The algorithm of the prediction
     */
    algorithm: z.enum(['catboost', 'transformers', 'ensemble', 'xgboost', 'original']),

    /**
     * The model of the prediction, example: 'v1_rsi7_macd5'
     */
    model: z.string(),
});

export type SinglePredictionSource = z.infer<typeof singlePredictionSourceSchema>;

const ensembleMemberSchema = singlePredictionSourceSchema.extend({
    weight: z.number().min(0).optional(),
});

export const ensemblePredictionSourceSchema = z
    .object({
        algorithm: z.literal('ensemble'),
        sources: z.array(ensembleMemberSchema).min(1),
        aggregationMode: z.enum(['mean', 'median', 'weighted', 'max', 'min', 'stacked', 'custom']),
    })
    .refine(data => data.aggregationMode !== 'weighted' || data.sources.every(s => s.weight !== undefined), {
        message: 'All ensemble members must have a weight when aggregationMode is weighted',
    });

export type AggregationMode = z.infer<typeof ensemblePredictionSourceSchema>['aggregationMode'];

export type EnsemblePredictionSource = z.infer<typeof ensemblePredictionSourceSchema>;

export const predictionSourceSchema = z.union([singlePredictionSourceSchema, ensemblePredictionSourceSchema]);

export type PredictionSource = z.infer<typeof predictionSourceSchema>;

/**
 * type guards for the prediction source
 */

export function isMultiSourceEnsemble(
    source: PredictionSource,
): source is z.infer<typeof ensemblePredictionSourceSchema> {
    return 'sources' in source && source.sources.length > 1;
}

export function isSingleSource(source: PredictionSource): source is z.infer<typeof singlePredictionSourceSchema> {
    return !('sources' in source) || source.sources.length <= 1;
}

export const strategyPredictionConfigSchema = z.object({
    /**
     * The number of most recent features that must be present for a prediction to proceed.
     */
    requiredFeaturesLength: z.number().positive(),

    /**
     * Optional upper limit on the number of features to consider for predictions.
     */
    upToFeaturesLength: z.number().positive().optional(),

    /**
     * Whether to skip predictions if all features are the same.
     * Useful to avoid redundant signals when data has no variation.
     */
    skipAllSameFeatures: z.boolean(),

    /**
     * Caching behavior for model predictions.
     */
    cache: z
        .object({
            enabled: z.boolean(),
            ttlSeconds: z.number().positive().optional(),
        })
        .optional(),
});
export type StrategyPredictionConfig = z.infer<typeof strategyPredictionConfigSchema>;

export type PredictionRequest = {
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
        devHoldingPercentageCirculating: number;
        topTenHoldingPercentageCirculating: number;
        topHolderCirculatingPercentage: number | null;
    }[];
};

type ConfidencePredictionBaseResponse = {
    /**
     * Confidence score of the buy prediction, ranging from 0 (no confidence)
     * to 1 (full confidence). Represents the model's certainty that the asset
     * is a good buy/sell.
     */
    confidence: number;
};

type ConfidencePredictionSingleModelResponse = ConfidencePredictionBaseResponse & {
    status: 'single_model_success';
};

export type ConfidencePredictionEnsembleResponse = ConfidencePredictionBaseResponse & {
    status: 'ensemble_success';
    aggregationMode: AggregationMode;
    individualResults: {
        algorithm: string;
        model: string;
        prediction: number;
        weight?: number;
    }[];
};

export type ConfidencePredictionEnsembleLocalResponse = {
    status: 'ensemble_success';
    confidence: number;
    aggregationMode: AggregationMode;
    individualResults: (SinglePredictionSource &
        (
            | {
                  confidence: number;
                  weight?: number;
              }
            | ConfidencePredictionEnsembleLocalResponse
        ))[];
};

export type ConfidencePredictionResponse =
    | ConfidencePredictionSingleModelResponse
    | ConfidencePredictionEnsembleResponse
    | ConfidencePredictionEnsembleLocalResponse;

export type PredictionStrategyShouldBuyResponseReason =
    | 'requiredFeaturesLength'
    | 'shouldBuyStateless'
    | 'noVariationInFeatures'
    | 'consecutivePredictionConfirmations'
    | 'prediction_error'
    | 'downside_prediction'
    | 'downside_prediction_error';

export type PredictionStrategyShouldSellResponseReason =
    | 'requiredFeaturesLength'
    | 'noVariationInFeatures'
    | 'prediction_error'
    | 'minPredictedSellConfidence'
    | 'no_limit_matches';

export const marketContextIntervalConfigSchema = z.object(
    Object.fromEntries(marketContextKeys.map(key => [key, intervalConfigSchema.optional()])) as Record<
        MarketContextKey,
        z.ZodOptional<typeof intervalConfigSchema>
    >,
);
export type LaunchpadStrategyBuyConfig = z.infer<typeof marketContextIntervalConfigSchema>;

export const strategySellConfigSchema = z.object({
    trailingStopLossPercentage: z.number().positive().optional(),
    stopLossPercentage: z.number().positive().optional(),
    takeProfitPercentage: z.number().positive().optional(),
    trailingTakeProfit: z
        .object({
            profitPercentage: z.number().positive(),
            stopPercentage: z.number().positive(),
        })
        .optional(),
});
export type StrategySellConfig = z.infer<typeof strategySellConfigSchema>;

export type AfterBuyResponse = {
    stopLoss?: number;
    trailingStopLossPercentage?: number;
    takeProfit?: number;
    trailingTakeProfit?: {
        trailingProfitPercentage: number;
        trailingStopPercentage: number;
    };
};

export interface Predictor<T = number> {
    predict(mint: string, historyRef: HistoryRef, context: MarketContext, history: HistoryEntry[]): Promise<T>;
}
