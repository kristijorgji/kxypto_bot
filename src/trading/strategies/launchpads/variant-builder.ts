import { MarketContext } from '../../bots/launchpads/types';
import { IntervalConfig, StrategySellConfig } from '../types';

export function variantFromBuyContext(context: Partial<Record<keyof MarketContext, IntervalConfig>>): string {
    const abbreviations: Record<keyof MarketContext, string> = {
        price: 'p',
        marketCap: 'mc',
        bondingCurveProgress: 'bcp',
        holdersCount: 'hc',
        devHoldingPercentage: 'dvp',
        topTenHoldingPercentage: 'tthp',
    };

    let variantConfig = '';
    let first = true;

    for (const key in context) {
        const interval = context[key as keyof MarketContext];

        if (interval === undefined || (!interval?.min && !interval?.max)) {
            continue;
        }

        variantConfig += `${first ? '' : '_'}${abbreviations[key as keyof MarketContext]}:`;

        if (interval?.min) {
            variantConfig += `l${interval.min}`;
        }
        if (interval?.max) {
            variantConfig += `${interval?.min ? '-' : ''}h${interval.max}`;
        }

        first = false;
    }

    return variantConfig;
}

export function variantFromSellConfig(c: StrategySellConfig): string {
    const abbreviations: Record<keyof StrategySellConfig, string> = {
        trailingStopLossPercentage: 'tslp',
        stopLossPercentage: 'slp',
        takeProfitPercentage: 'tpp',
        trailingTakeProfit: 'ttp',
    };

    let r = '';
    let first = true;

    for (const [key, value] of Object.entries(c)) {
        if (value === undefined) {
            continue;
        }

        const cKey = key as keyof StrategySellConfig;

        r += `${first ? '' : '_'}`;

        if (cKey === 'trailingTakeProfit') {
            const v = value as {
                profitPercentage: number;
                stopPercentage: number;
            };
            r += `${abbreviations[cKey]}(pp:${v.profitPercentage}:sp:${v.stopPercentage})`;
        } else {
            r += `${abbreviations[cKey]}:${value}`;
        }

        first = false;
    }

    return r;
}
