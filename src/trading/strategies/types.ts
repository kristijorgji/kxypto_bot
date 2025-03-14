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
