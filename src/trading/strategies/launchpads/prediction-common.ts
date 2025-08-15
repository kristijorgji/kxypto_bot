import { AxiosInstance, AxiosResponse, HttpStatusCode } from 'axios';
import Redis from 'ioredis';
import { Logger } from 'winston';

import { BuyPredictionStrategyShouldBuyResponseReason } from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import {
    BuySellPredictionStrategyConfig,
    BuySellPredictionStrategyShouldSellResponseReason,
} from '@src/trading/strategies/launchpads/BuySellPredictionStrategy';
import { deepEqual } from '@src/utils/data/equals';

import { shouldBuyStateless } from './common';
import { HistoryRef } from '../../bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldBuyResponse, ShouldSellResponse } from '../../bots/types';
import {
    ConfidencePredictionEnsembleResponse,
    ConfidencePredictionResponse,
    IntervalConfig,
    PredictionRequest,
    PredictionSource,
    StrategyPredictionConfig,
} from '../types';

const CacheDefaultTtlSeconds = 3600 * 24 * 7;

type FormPredictionRequestFailReason = 'noVariationInFeatures';

function formPredictionRequest(
    logger: Logger,
    config: {
        prediction: StrategyPredictionConfig;
    },
    mint: string,
    history: HistoryEntry[],
):
    | PredictionRequest
    | {
          reason: FormPredictionRequestFailReason;
      } {
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
                reason: 'noVariationInFeatures',
            };
        }
    }

    return requestBody;
}

interface PredictStrategyDependencies {
    logger: Logger;
    client: AxiosInstance;
    cache: Redis;
}

type PredictionErrorData = {
    response: {
        status: HttpStatusCode;
        body: unknown;
    };
};

export type ShouldBuyParams = {
    deps: PredictStrategyDependencies;
    source: PredictionSource;
    config: {
        prediction: StrategyPredictionConfig;
        buy: {
            minPredictedConfidence: number;
            minConsecutivePredictionConfirmations?: number;
            context?: Partial<Record<keyof MarketContext, IntervalConfig>>;
        };
    };
    cacheBaseKey: string;
    cacheDefaultTtlSeconds?: number;
    consecutivePredictionConfirmations: number;
    setConsecutivePredictionConfirmations: (value: number) => number;
};

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

    const res = formPredictionRequest(logger, config, mint, history);
    if ((res as unknown as { reason: FormPredictionRequestFailReason }).reason) {
        return {
            buy: false,
            reason: (res as unknown as { reason: FormPredictionRequestFailReason }).reason,
        };
    }

    return res as unknown as PredictionRequest;
}

type BuyResponseSuccessData = {
    predictedBuyConfidence: number;
    consecutivePredictionConfirmations?: number;
    individualResults?: ConfidencePredictionEnsembleResponse['individual_results'];
};

type ShouldBuyWithBuyPredictionResponse = ShouldBuyResponse<
    BuyPredictionStrategyShouldBuyResponseReason,
    PredictionErrorData | BuyResponseSuccessData
>;

export async function shouldBuyWithBuyPrediction(
    {
        deps,
        source,
        config,
        cacheBaseKey,
        cacheDefaultTtlSeconds,
        consecutivePredictionConfirmations,
        setConsecutivePredictionConfirmations,
    }: ShouldBuyParams,
    mint: string,
    historyRef: HistoryRef,
    context: MarketContext,
    history: HistoryEntry[],
): Promise<ShouldBuyWithBuyPredictionResponse> {
    const { logger, client, cache } = deps;

    const r = await shouldBuyCommon(logger, mint, historyRef, context, history, config);
    if ((r as ShouldBuyResponse)?.reason) {
        return r as ShouldBuyWithBuyPredictionResponse;
    }
    const predictionRequest = r as PredictionRequest;

    let predictionResponse: AxiosResponse | undefined;
    let prediction: ConfidencePredictionResponse | undefined;

    let cacheKey: string | undefined;
    let cached;
    if (config.prediction.cache?.enabled) {
        cacheKey = `${cacheBaseKey}_${mint}_${historyRef.index}:${predictionRequest.features.length}`;
        cached = await cache.get(cacheKey);
    }

    if (cached) {
        prediction = JSON.parse(cached);
    } else {
        predictionResponse = await client.post<ConfidencePredictionResponse>(source.endpoint, predictionRequest);
        if (predictionResponse.status === 200) {
            if (predictionResponse.data.confidence === undefined) {
                throw new Error(
                    `The response is missing the required field confidence. ${JSON.stringify(predictionResponse.data)}`,
                );
            } else if (predictionResponse.data.confidence < 0 || predictionResponse.data.confidence > 1) {
                throw new Error(
                    `Expected confidence to be in the interval [0, 1], but got ${predictionResponse.data.confidence}`,
                );
            } else {
                prediction = predictionResponse.data as ConfidencePredictionResponse;
                if (config.prediction.cache?.enabled) {
                    cache.set(
                        cacheKey!,
                        JSON.stringify(prediction),
                        'EX',
                        config.prediction.cache.ttlSeconds ?? cacheDefaultTtlSeconds ?? CacheDefaultTtlSeconds,
                    );
                }
            }
        } else {
            logger.error('Error getting buy prediction for mint %s, returning false', mint);
            logger.error(predictionResponse);
        }
    }

    if (!prediction) {
        return {
            buy: false,
            reason: 'prediction_error',
            data: {
                response: {
                    status: predictionResponse!.status,
                    body: predictionResponse!.data,
                },
            },
        };
    }

    const responseData: BuyResponseSuccessData = {
        predictedBuyConfidence: prediction.confidence,
    };
    if ((prediction as ConfidencePredictionEnsembleResponse)?.status === 'ensemble_success') {
        responseData.individualResults = (prediction as ConfidencePredictionEnsembleResponse).individual_results;
    }

    if (prediction.confidence >= config.buy.minPredictedConfidence) {
        consecutivePredictionConfirmations = setConsecutivePredictionConfirmations(
            consecutivePredictionConfirmations + 1,
        );

        return {
            buy: consecutivePredictionConfirmations >= (config?.buy.minConsecutivePredictionConfirmations ?? 1),
            reason: 'consecutivePredictionConfirmations',
            data: {
                ...responseData,
                consecutivePredictionConfirmations: consecutivePredictionConfirmations,
            },
        };
    } else {
        setConsecutivePredictionConfirmations(0);

        return {
            buy: false,
            reason: 'minPredictedBuyConfidence',
            data: responseData,
        };
    }
}

export type ShouldSellParams = {
    deps: PredictStrategyDependencies;
    source: PredictionSource;
    config: {
        prediction: StrategyPredictionConfig;
        sell: BuySellPredictionStrategyConfig['sell'];
    };
    cacheBaseKey: string;
    cacheDefaultTtlSeconds?: number;
    consecutivePredictionConfirmations: number;
    setConsecutivePredictionConfirmations: (value: number) => number;
};

type SellResponseSuccessData = {
    predictedSellConfidence: number;
    consecutivePredictionConfirmations?: number;
    individualResults?: ConfidencePredictionEnsembleResponse['individual_results'];
};

export async function shouldSellPredicted(
    {
        deps,
        source,
        config,
        cacheBaseKey,
        cacheDefaultTtlSeconds,
        consecutivePredictionConfirmations,
        setConsecutivePredictionConfirmations,
    }: ShouldSellParams,
    mint: string,
    historyRef: HistoryRef,
    _context: MarketContext,
    history: HistoryEntry[],
): Promise<
    ShouldSellResponse<BuySellPredictionStrategyShouldSellResponseReason, PredictionErrorData | SellResponseSuccessData>
> {
    const { logger, client, cache } = deps;

    if (history.length < config.prediction.requiredFeaturesLength) {
        return {
            sell: false,
            reason: 'requiredFeaturesLength',
        };
    }

    const res = formPredictionRequest(logger, config, mint, history);
    if ((res as unknown as { reason: FormPredictionRequestFailReason }).reason) {
        return {
            sell: false,
            reason: (res as unknown as { reason: FormPredictionRequestFailReason }).reason,
        };
    }
    const predictionRequest = res as PredictionRequest;

    let predictionResponse: AxiosResponse | undefined;
    let prediction: ConfidencePredictionResponse | undefined;

    let cacheKey: string | undefined;
    let cached;
    if (config.prediction.cache?.enabled) {
        cacheKey = `${cacheBaseKey}_${mint}_${historyRef.index}:${predictionRequest.features.length}`;
        cached = await cache.get(cacheKey);
    }

    if (cached) {
        prediction = JSON.parse(cached);
    } else {
        predictionResponse = await client.post<ConfidencePredictionResponse>(source.endpoint, predictionRequest);
        if (predictionResponse.status === 200) {
            if (predictionResponse.data.confidence === undefined) {
                throw new Error(
                    `The response is missing the required field confidence. ${JSON.stringify(predictionResponse.data)}`,
                );
            } else if (predictionResponse.data.confidence < 0 || predictionResponse.data.confidence > 1) {
                throw new Error(
                    `Expected confidence to be in the interval [0, 1], but got ${predictionResponse.data.confidence}`,
                );
            } else {
                prediction = predictionResponse.data as ConfidencePredictionResponse;
                if (config.prediction.cache?.enabled) {
                    cache.set(
                        cacheKey!,
                        JSON.stringify(prediction),
                        'EX',
                        config.prediction.cache.ttlSeconds ?? cacheDefaultTtlSeconds ?? CacheDefaultTtlSeconds,
                    );
                }
            }
        } else {
            logger.error('Error getting sell prediction for mint %s, returning false', mint);
            logger.error(predictionResponse);
        }
    }

    if (!prediction) {
        return {
            sell: false,
            reason: 'prediction_error',
            data: {
                response: {
                    status: predictionResponse!.status,
                    body: predictionResponse!.data,
                },
            },
        };
    }

    const responseData = {
        predictedSellConfidence: prediction.confidence,
    };

    if (prediction.confidence >= config.sell.minPredictedConfidence) {
        consecutivePredictionConfirmations = setConsecutivePredictionConfirmations(
            consecutivePredictionConfirmations + 1,
        );

        return {
            sell: consecutivePredictionConfirmations >= (config?.sell.minConsecutivePredictionConfirmations ?? 1),
            reason: 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS',
            data: {
                ...responseData,
                consecutivePredictionConfirmations: consecutivePredictionConfirmations,
            },
        };
    } else {
        setConsecutivePredictionConfirmations(0);

        return {
            sell: false,
            reason: 'minPredictedSellConfidence',
            data: responseData,
        };
    }
}

type PredictionType = 'price' | 'buy' | 'sell';

const predictionTypeAbbreviation: Record<PredictionType, string> = {
    price: 'p',
    buy: 'b',
    sell: 's',
};

export function formBaseCacheKey(
    predictionType: 'price' | 'buy' | 'sell',
    prediction: StrategyPredictionConfig,
    source: PredictionSource,
): string {
    const pc = prediction.skipAllSameFeatures !== undefined ? `skf:${prediction.skipAllSameFeatures}` : '';
    return `${predictionTypeAbbreviation[predictionType]}p.${source.algorithm[0]}_${source.model}${pc.length === 0 ? '' : `_${pc}`}`;
}
