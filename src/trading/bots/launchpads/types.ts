/**
 * A launchpad bot is used for trading SMALL tokens that are launched via platforms like pumpfun, moonshot etc.
 * These bots can be used to trade with holders up to 1k or so and are not effective in larger more stable coins
 */
import { z } from 'zod';

export type HistoryEntry = {
    timestamp: number;
    price: number;
    marketCap: number;
    bondingCurveProgress: number;
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
    devHoldingPercentageCirculating: number;
    topTenHoldingPercentageCirculating: number;
    topHolderCirculatingPercentage: number | null;
    /**
     * Optional field used only for troubleshooting and debugging
     * It is not needed elsewhere in backtests or other places
     */
    _metadata?: {
        action?:
            | 'startBuy'
            | 'buyCompleted'
            | 'buyError'
            | 'startSell'
            | 'sellCompleted'
            | 'sellError'
            | 'strategyExit';
        diffSincePurchase?: {
            percent: number;
            inSol: number;
        };
    };
};

export const marketContextSchema = z.object({
    price: z.number().gte(0),
    marketCap: z.number().gte(0),
    bondingCurveProgress: z.number().gte(0),
    holdersCount: z.number().gte(0),
    devHoldingPercentage: z.number().gte(0),
    topTenHoldingPercentage: z.number().gte(0),
    devHoldingPercentageCirculating: z.number().gte(0),
    topTenHoldingPercentageCirculating: z.number().gte(0),
    topHolderCirculatingPercentage: z.number().gte(0).nullable(),
});
export type MarketContext = z.infer<typeof marketContextSchema>;

export const marketContextKeys = [
    'price',
    'marketCap',
    'bondingCurveProgress',
    'holdersCount',
    'devHoldingPercentage',
    'topTenHoldingPercentage',
    'devHoldingPercentageCirculating',
    'topTenHoldingPercentageCirculating',
    'topHolderCirculatingPercentage',
] as const;

export type MarketContextKey = (typeof marketContextKeys)[number];
