import { TradeTransaction } from '../bots/blockchains/solana/types';
import { MarketContext } from '../bots/launchpads/types';

export type StrategyConfig<C = Record<string, unknown>> = {
    variant?: string;
    /**
     * don't waste time on a token anymore if there is no increase until this time is reached
     */
    maxWaitMs: number;
    buySlippageDecimal: number;
    sellSlippageDecimal: number;
    priorityFeeInSol?: number;
    buyPriorityFeeInSol?: number;
    sellPriorityFeeInSol?: number;
} & C;

export type IntervalConfig = {
    min?: number;
    max?: number;
};

export type LaunchpadBuyPosition = {
    marketContext: MarketContext;
    transaction: TradeTransaction;
};

export type PredictionSource = {
    endpoint: string;
    /**
     * The model of the prediction, example: 'v1_rsi7_macd5'
     */
    model: string;
};

export type StrategyPredictionConfig = {
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
};

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
    }[];
};

export type PredictionStrategyShouldBuyResponseReason =
    | 'requiredFeaturesLength'
    | 'shouldBuyStateless'
    | 'noVariationInFeatures'
    | 'consecutivePredictionConfirmations'
    | 'prediction_error';

export type LaunchpadStrategyBuyConfig = Partial<Record<keyof MarketContext, IntervalConfig>>;

export type StrategySellConfig = {
    trailingStopLossPercentage?: number;
    stopLossPercentage?: number;
    takeProfitPercentage?: number;
    trailingTakeProfit?: {
        profitPercentage: number;
        stopPercentage: number;
    };
};

export type AfterBuyResponse = {
    stopLoss?: number;
    trailingStopLossPercentage?: number;
    takeProfit?: number;
    trailingTakeProfit?: {
        trailingProfitPercentage: number;
        trailingStopPercentage: number;
    };
};
