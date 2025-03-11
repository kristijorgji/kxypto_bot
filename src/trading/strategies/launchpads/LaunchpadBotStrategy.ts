import crypto from 'crypto';

import { TradeTransaction } from '../../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import { AfterBuyResponse, StrategyConfig } from '../types';

export default abstract class LaunchpadBotStrategy {
    abstract readonly name: string;

    get configVariant(): string {
        return this.config.variant || '';
    }

    abstract readonly description: string;

    abstract readonly config: StrategyConfig;

    get identifier(): string {
        return formStrategyId(this);
    }

    abstract get buyPosition(): TradeTransaction | undefined;

    abstract shouldExit(
        context: MarketContext,
        history: HistoryEntry[],
        extra: {
            elapsedMonitoringMs: number;
        },
    ): ShouldExitMonitoringResponse;

    abstract shouldBuy(context: MarketContext, history: HistoryEntry[]): boolean;

    abstract afterBuy(buyPrice: number, buyPosition: TradeTransaction): AfterBuyResponse;

    abstract shouldSell(context: MarketContext, history: HistoryEntry[]): ShouldSellResponse;

    abstract afterSell(): void;

    /**
     * This must be always called in order to reuse the strategy with a new asset
     */
    abstract resetState(): void;
}

function formStrategyId(strategy: LaunchpadBotStrategy): string {
    return `${strategy.name}_${generateConfigHash(strategy.config)}`;
}

function generateConfigHash(config: object): string {
    const jsonString = JSON.stringify(config);

    return crypto.createHash('md5').update(jsonString).digest('hex').slice(0, 8);
}
