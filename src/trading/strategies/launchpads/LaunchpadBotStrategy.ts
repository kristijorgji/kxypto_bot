import crypto from 'crypto';

import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldExitMonitoringResponse, ShouldSellResponse } from '../../bots/types';
import { AfterBuyResponse, LaunchpadBuyPosition, StrategyConfig } from '../types';

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

    abstract get buyPosition(): LaunchpadBuyPosition | undefined;

    abstract shouldExit(
        context: MarketContext,
        history: HistoryEntry[],
        extra: {
            elapsedMonitoringMs: number;
        },
    ): ShouldExitMonitoringResponse;

    abstract shouldBuy(mint: string, context: MarketContext, history: HistoryEntry[]): Promise<ShouldBuyResponse>;

    abstract afterBuy(buyPrice: number, buyPosition: LaunchpadBuyPosition): AfterBuyResponse;

    abstract shouldSell(mint: string, context: MarketContext, history: HistoryEntry[]): Promise<ShouldSellResponse>;

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
