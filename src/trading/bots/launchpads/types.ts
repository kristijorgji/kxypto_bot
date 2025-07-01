/**
 * A launchpad bot is used for trading SMALL tokens that are launched via platforms like pumpfun, moonshot etc.
 * These bots can be used to trade with holders up to 1k or so and are not effective in larger more stable coins
 */

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

export type MarketContext = {
    price: number;
    marketCap: number;
    bondingCurveProgress: number;
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
    devHoldingPercentageCirculating: number;
    topTenHoldingPercentageCirculating: number;
};
