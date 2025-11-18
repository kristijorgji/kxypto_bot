import {
    BuyPredictionStrategyConfig,
    DownsideProtectionConfig,
} from '@src/trading/strategies/launchpads/BuyPredictionStrategy';

import { MarketContext } from '../../bots/launchpads/types';
import {
    AggregationMode,
    IntervalConfig,
    LocalEnsembleMemberPredictionSource,
    PredictionConfig,
    PredictionSource,
    RemoteEnsembleMemberPredictionSource,
    SinglePredictionSource,
    StrategySellConfig,
    isSingleSource,
} from '../types';

export function variantFromBuyContext(context: Partial<Record<keyof MarketContext, IntervalConfig>>): string {
    const abbreviations: Record<keyof MarketContext, string> = {
        price: 'p',
        marketCap: 'mc',
        bondingCurveProgress: 'bcp',
        holdersCount: 'hc',
        devHoldingPercentage: 'dvp',
        topTenHoldingPercentage: 'tthp',
        devHoldingPercentageCirculating: 'dvpc',
        topTenHoldingPercentageCirculating: 'tthpc',
        topHolderCirculatingPercentage: 'thpc',
    };

    let variantConfig = '';
    let first = true;

    for (const key in context) {
        const interval = context[key as keyof MarketContext];

        if (interval === undefined || (interval?.min === undefined && interval?.max === undefined)) {
            continue;
        }

        variantConfig += `${first ? '' : '_'}${abbreviations[key as keyof MarketContext]}:`;

        if (interval?.min !== undefined) {
            variantConfig += `l${interval.min}`;
        }
        if (interval?.max !== undefined) {
            variantConfig += `${interval?.min !== undefined ? '-' : ''}h${interval.max}`;
        }

        first = false;
    }

    return variantConfig;
}

export function variantFromBuyDownside(c: DownsideProtectionConfig): string {
    return `downsideProtection(${variantFromPredictionSource(c.source)}_p(${variantFromPredictionConfig(
        c.prediction,
    )})_mpc:${c.minPredictedConfidence})`;
}

export function variantFromBuyConfig(c: BuyPredictionStrategyConfig['buy']): string {
    let r = `buy(mpc:${c.minPredictedConfidence}`;

    if (c.minConsecutivePredictionConfirmations && c.minConsecutivePredictionConfirmations !== 1) {
        r += `_mcpc:${c.minConsecutivePredictionConfirmations}`;
    }

    if (c.context) {
        r += `_c(${variantFromBuyContext(c.context)})`;
    }

    if (c.downsideProtection) {
        r += `_${variantFromBuyDownside(c.downsideProtection)}`;
    }

    r += ')';

    return r;
}

export function variantFromSellContext(c: StrategySellConfig): string {
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

export function variantFromPredictionSource(s: PredictionSource): string {
    if (isSingleSource(s)) {
        return `${s.algorithm[0]}_${s.model}`;
    } else {
        // use user specified model
        if (s.model) {
            return `${s.algorithm[0]}_${s.model}`;
        }

        return `e_${buildEnsemblePredictionModel(s.aggregationMode, s.sources)}`;
    }
}

export function buildEnsemblePredictionModel(
    aggregationMode: AggregationMode,
    sources: LocalEnsembleMemberPredictionSource[] | RemoteEnsembleMemberPredictionSource[],
): string {
    let p = '';

    // detect if it is fold pattern so we can use shorter generated variant
    let sameAlgorithm = true;
    let foldPattern = true;

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];

        if (i > 0 && source.algorithm !== sources[i - 1].algorithm) {
            sameAlgorithm = false;
        }

        if (!source.model.includes('fold_')) {
            foldPattern = false;
        }

        p += `(${variantFromSinglePredictionSource(source)}`;
        if (aggregationMode === 'weighted') {
            p += `:w${source.weight!}`;
        }
        p += ')';
        if (i < sources.length - 1) {
            p += '+';
        }
    }

    const prefix = `ag:${aggregationMode}`;

    if (foldPattern && sameAlgorithm && ['mean', 'min', 'max'].includes(aggregationMode)) {
        const onlyModel = sources[0].model.replace(/_fold_\d+/g, '');
        return `${prefix}_${sources[0].algorithm}_${onlyModel}_fold_0_${sources.length - 1}`;
    }

    return `${prefix}_[${p}]`;
}

function variantFromSinglePredictionSource(s: Omit<SinglePredictionSource, 'endpoint'>): string {
    return `${s.algorithm[0]}_${s.model}`;
}

export function variantFromPredictionConfig(c: PredictionConfig): string {
    const parts: Record<string, string | undefined | boolean | number> = {
        skf: c.skipAllSameFeatures,
        rql: c.requiredFeaturesLength,
        upfl: c.upToFeaturesLength,
    };

    let r = '';
    let first = true;

    for (const key in parts) {
        const val = parts[key];
        if (val === undefined) {
            continue;
        }

        r = `${r}${first ? '' : '_'}${key}:${val?.toString()}`;
        first = false;
    }

    return r;
}
