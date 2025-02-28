import { MarketContext } from '../../bots/launchpads/types';
import { IntervalConfig, LaunchpadStrategyBuyConfig } from '../types';

export function shouldBuyStateless(buyConfig: LaunchpadStrategyBuyConfig, marketContext: MarketContext): boolean {
    let buy = true;

    for (const key in marketContext) {
        buy &&= checkInterval(buyConfig[key as keyof MarketContext], marketContext[key as keyof MarketContext]);
    }

    return buy;
}

export function checkInterval(config: IntervalConfig | undefined, value: number): boolean {
    let valid = true;

    if (!config) {
        return true;
    }

    if (config.min) {
        valid &&= value >= config.min;
    }

    if (config.max) {
        valid &&= value <= config.max;
    }

    return valid;
}
