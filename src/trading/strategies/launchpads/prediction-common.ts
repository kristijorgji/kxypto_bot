import { Logger } from 'winston';

import { deepEqual } from '@src/utils/data/equals';

import { shouldBuyStateless } from './common';
import { HistoryRef } from '../../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse } from '../../bots/types';
import { IntervalConfig, PredictionRequest, StrategyPredictionConfig } from '../types';

export async function shouldBuyCommon(
    logger: Logger,
    mint: string,
    _historyRef: HistoryRef,
    context: MarketContext,
    history: HistoryEntry[],
    config: {
        prediction: StrategyPredictionConfig;
        buy: {
            context?: Partial<Record<keyof MarketContext, IntervalConfig>>;
        };
    },
): Promise<
    ShouldBuyResponse<'requiredFeaturesLength' | 'shouldBuyStateless' | 'noVariationInFeatures'> | PredictionRequest
> {
    if (history.length < config.prediction.requiredFeaturesLength) {
        return {
            buy: false,
            reason: 'requiredFeaturesLength',
        };
    }

    if (config.buy.context && !shouldBuyStateless(config.buy.context, context)) {
        return {
            buy: false,
            reason: 'shouldBuyStateless',
        };
    }

    const featuresCountToSend = config.prediction.upToFeaturesLength
        ? Math.min(history.length, config.prediction.upToFeaturesLength)
        : config.prediction.requiredFeaturesLength;

    const requestBody: PredictionRequest = {
        mint: mint,
        features: history.slice(-featuresCountToSend).map(
            e =>
                ({
                    timestamp: e.timestamp,
                    timeFromStartMs: e.timestamp - history[0].timestamp,
                    price: e.price,
                    marketCap: e.marketCap,
                    bondingCurveProgress: e.bondingCurveProgress,
                    holdersCount: e.holdersCount,
                    devHoldingPercentage: e.devHoldingPercentage,
                    topTenHoldingPercentage: e.topTenHoldingPercentage,
                    devHoldingPercentageCirculating: e.devHoldingPercentageCirculating,
                    topTenHoldingPercentageCirculating: e.topTenHoldingPercentageCirculating,
                    topHolderCirculatingPercentage: e.topHolderCirculatingPercentage,
                }) satisfies PredictionRequest['features'][number],
        ),
    };

    // because the scaler will use 0 value if all features are exactly same objects, while excluding the timestamp that always changes
    if (config.prediction.skipAllSameFeatures) {
        let areSame = true;
        for (let i = 1; i < requestBody.features.length; i++) {
            const features = requestBody.features[i];

            if (!deepEqual(features, requestBody.features[i - 1], new Set(['timestamp', 'timeFromStartMs']))) {
                areSame = false;
                break;
            }
        }

        if (areSame) {
            logger.debug('There is no variation in the %d features, returning false', requestBody.features.length);
            return {
                buy: false,
                reason: 'noVariationInFeatures',
            };
        }
    }

    return requestBody;
}
