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
    _afterResult: boolean; // if this history record was added after we exited or made a trade
};

export type MarketContext = {
    price: number;
    marketCap: number;
    bondingCurveProgress: number;
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
};
