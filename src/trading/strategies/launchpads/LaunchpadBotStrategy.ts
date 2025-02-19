import { TradeTransaction } from '../../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';

export interface LaunchpadBotStrategy {
    readonly name: string;

    readonly description: string;

    readonly config: {
        buyMonitorWaitPeriodMs: number;
        sellMonitorWaitPeriodMs: number;
        maxWaitMs: number; // don't waste time on a token anymore if there is no increase until this time is reached
    };

    get buyPosition(): TradeTransaction | undefined;

    shouldExit(
        context: MarketContext,
        history: HistoryEntry[],
        extra: {
            elapsedMonitoringMs: number;
        },
    ): ShouldExitMonitoringResponse;

    shouldBuy(context: MarketContext, history: HistoryEntry[]): boolean;

    afterBuy(buyPrice: number, buyPosition: TradeTransaction): void;

    shouldSell(context: MarketContext, history: HistoryEntry[]): ShouldSellResponse;

    afterSell(): void;

    /**
     * This must be always called in order to reuse the strategy with a new asset
     */
    resetState(): void;
}
