import { AxiosInstance, AxiosResponse, HttpStatusCode } from 'axios';
import Redis from 'ioredis';
import { Logger } from 'winston';

import { HistoryRef, ShouldBuyResponse, ShouldSellResponse } from '@src/trading/bots/types';
import { aggregateValue } from '@src/trading/strategies/aggregation';
import {
    BuyPredictionStrategyConfig,
    BuyPredictionStrategyShouldBuyResponseReason,
} from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import {
    BuySellPredictionStrategyConfig,
    BuySellPredictionStrategyShouldSellResponseReason,
} from '@src/trading/strategies/launchpads/BuySellPredictionStrategy';
import { buildEnsemblePredictionModel } from '@src/trading/strategies/launchpads/variant-builder';
import DownsidePredictor, {
    DownsidePredictorResponse,
    PredictorNotStartReason,
} from '@src/trading/strategies/predictors/DownsidePredictor';
import { deepEqual, isObject } from '@src/utils/data/equals';

import { shouldBuyStateless } from './common';
import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import {
    AggregationMode,
    ConfidencePredictionEnsembleLocalResponse,
    ConfidencePredictionEnsembleResponse,
    ConfidencePredictionResponse,
    IntervalConfig,
    LocalEnsemblePredictionSource,
    PredictionConfig,
    PredictionRequest,
    PredictionSource,
    RemoteEnsembleMemberPredictionSource,
    RemoteEnsemblePredictionSource,
    SinglePredictionSource,
    isMultiSourceEnsemble,
} from '../types';

const CacheDefaultTtlSeconds = 3600 * 24 * 30;

export type FormPredictionRequestFailReason = 'noVariationInFeatures';

/**
 * Converts a remote ensemble definition into a single prediction source request.
 *
 * The remote endpoint is expected to support the following query parameters:
 *   - `model_types`:    the list of model types used by the ensemble
 *   - `model_names`:    the list of model identifiers/names
 *   - `weights`:        optional array of numeric weights (only for weighted mode)
 *
 * This function builds a `SinglePredictionSource` that points to the remote
 * aggregation endpoint and encodes the ensemble members + aggregation mode
 * in the query string.
 *
 * @param endpoint         The remote aggregation endpoint URL.
 * @param members          The ensemble members without local endpoint fields.
 * @param aggregationMode  The aggregation strategy used by the remote ensemble.
 * @returns                A `SinglePredictionSource` targeting the remote endpoint.
 */
export function buildRemoteEnsembleSingleSource(
    endpoint: string,
    members: RemoteEnsembleMemberPredictionSource[],
    aggregationMode: AggregationMode,
): RemoteEnsemblePredictionSource {
    const queryParams = new URLSearchParams();

    for (const member of members) {
        queryParams.append('model_types', member.algorithm);
        queryParams.append('model_names', member.model);
        if (aggregationMode === 'weighted') {
            queryParams.append('weights', member.weight!.toString());
        }
    }

    queryParams.append('aggregation_mode', aggregationMode);

    return {
        algorithm: 'ensemble',
        endpoint: `${endpoint}?${queryParams}`,
        sources: members,
        aggregationMode: aggregationMode,
        model: buildEnsemblePredictionModel(aggregationMode, members),
    };
}

export function formPredictionRequest(
    logger: Logger,
    config: {
        prediction: PredictionConfig;
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

type MakePredictionRequestErrorResponse = {
    error: {
        request: PredictionRequest;
        response: AxiosResponse;
    };
};

type MakePredictionRequestEnsembleErrorResponse = {
    ensembleError: string;
};

export type MakePredictionRequestResponse =
    | ConfidencePredictionResponse
    | MakePredictionRequestErrorResponse
    | MakePredictionRequestEnsembleErrorResponse;

export async function makePredictionRequest(
    client: AxiosInstance,
    cache: Redis,
    source: PredictionSource,
    config: {
        prediction: PredictionConfig;
    },
    cacheBaseKey: string | string[],
    mint: string,
    historyRef: HistoryRef,
    predictionRequest: PredictionRequest,
    cacheDefaultTtlSeconds: number | undefined,
): Promise<MakePredictionRequestResponse> {
    return isMultiSourceEnsemble(source)
        ? await makeEnsemblePredictionRequest(
              client,
              cache,
              source,
              config,
              cacheBaseKey as string[],
              mint,
              historyRef,
              predictionRequest,
              cacheDefaultTtlSeconds,
          )
        : await makeSinglePredictionRequest(
              client,
              cache,
              source,
              config,
              cacheBaseKey as string,
              mint,
              historyRef,
              predictionRequest,
              cacheDefaultTtlSeconds,
          );
}

async function makeSinglePredictionRequest(
    client: AxiosInstance,
    cache: Redis,
    source: SinglePredictionSource,
    config: {
        prediction: PredictionConfig;
    },
    cacheBaseKey: string,
    mint: string,
    historyRef: HistoryRef,
    predictionRequest: PredictionRequest,
    cacheDefaultTtlSeconds: number | undefined,
): Promise<MakePredictionRequestResponse> {
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
            return {
                error: {
                    request: predictionRequest,
                    response: predictionResponse,
                },
            };
        }
    }

    if (!prediction) {
        throw new Error('Prediction must be defined at this point');
    }

    return prediction;
}

async function makeEnsemblePredictionRequest(
    client: AxiosInstance,
    cache: Redis,
    source: LocalEnsemblePredictionSource,
    config: {
        prediction: PredictionConfig;
    },
    cacheBaseKey: string[],
    mint: string,
    historyRef: HistoryRef,
    predictionRequest: PredictionRequest,
    cacheDefaultTtlSeconds: number | undefined,
): Promise<
    | ConfidencePredictionEnsembleLocalResponse
    | {
          ensembleError: string;
      }
> {
    const responses = await Promise.allSettled(
        source.sources.map((el, index) =>
            makeSinglePredictionRequest(
                client,
                cache,
                el,
                config,
                cacheBaseKey[index],
                mint,
                historyRef,
                predictionRequest,
                cacheDefaultTtlSeconds,
            ),
        ),
    );

    const fatalErrors: Error[] = [];
    const nonFatalErrors: string[] = [];
    const confidencePredictions: ConfidencePredictionResponse[] = [];

    for (let i = 0; i < responses.length; i++) {
        const response = responses[i];

        if (response.status === 'rejected') {
            fatalErrors.push(response.reason);
        } else {
            if ((response.value as MakePredictionRequestErrorResponse).error) {
                const prerr = (response.value as MakePredictionRequestErrorResponse).error.response;
                nonFatalErrors.push(
                    `[${source.sources[i].endpoint}] - ${prerr.status}: ${isObject(prerr.data) ? JSON.stringify(prerr.data) : prerr.data.toString()}`,
                );
            } else {
                confidencePredictions.push(response.value as ConfidencePredictionResponse);
            }
        }
    }

    if (fatalErrors.length > 0) {
        throw fatalErrors[0];
    }

    if (nonFatalErrors.length > 0) {
        return {
            ensembleError: nonFatalErrors.join('\n'),
        };
    }

    const weights = source.aggregationMode === 'weighted' ? source.sources.map(s => s.weight!) : undefined;

    return {
        status: 'ensemble_success',
        confidence: aggregateValue(
            source.aggregationMode,
            confidencePredictions.map(e => e.confidence),
            weights,
        ),
        aggregationMode: source.aggregationMode,
        individualResults: confidencePredictions.map((e, index) => {
            const base = {
                algorithm: source.sources[index].algorithm,
                model: source.sources[index].model,
                endpoint: source.sources[index].endpoint,
                confidence: e.confidence,
                weight: weights ? weights[index] : undefined,
            };

            if ((e as ConfidencePredictionEnsembleResponse).status === 'ensemble_success') {
                return {
                    ...base,
                    aggregationMode: 'mean',
                    individualResults: (e as ConfidencePredictionEnsembleResponse).individualResults,
                };
            }

            return base;
        }),
    };
}

interface PredictStrategyDependencies {
    logger: Logger;
    client: AxiosInstance;
    cache: Redis;
}

export type PredictionErrorData = {
    response: {
        status: HttpStatusCode;
        body: unknown;
    };
};

export type ShouldBuyParams = {
    deps: PredictStrategyDependencies & {
        downsidePredictor?: DownsidePredictor;
    };
    source: PredictionSource;
    config: {
        prediction: PredictionConfig;
        buy: BuyPredictionStrategyConfig['buy'];
    };
    /**
     * Cache key(s) used to identify prediction results.
     * - For single-source predictions: a single string key.
     * - For ensemble predictions: an array of keys, where each index corresponds to a source in `sources`.
     */
    cacheBaseKey: string | string[];
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
        prediction: PredictionConfig;
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

export type BuyResponseSuccessData = {
    predictedBuyConfidence: number;
    consecutivePredictionConfirmations?: number;
    aggregationMode?: AggregationMode;
    individualResults?: ConfidencePredictionEnsembleResponse['individualResults'];
};

type ShouldBuyBaseResponseData =
    | BuyResponseSuccessData
    | PredictionErrorData
    | {
          error: string;
      };

type DownsideResponseSuccessData = {
    predictedConfidence: number;
    aggregationMode?: AggregationMode;
    individualResults?: ConfidencePredictionEnsembleResponse['individualResults'];
};

type DownsideResponseData =
    | DownsideResponseSuccessData
    | {
          response: PredictionErrorData['response'] | MakePredictionRequestEnsembleErrorResponse;
      }
    | {
          notStartReason: PredictorNotStartReason['stopReason'];
      };

type ShouldBuyResponseData =
    | ShouldBuyBaseResponseData
    | (ShouldBuyBaseResponseData & {
          downside: DownsideResponseData;
      });

type ShouldBuyWithBuyPredictionResponse = ShouldBuyResponse<
    BuyPredictionStrategyShouldBuyResponseReason,
    ShouldBuyResponseData
>;

export async function shouldBuyWithBuyPrediction(
    p: ShouldBuyParams,
    mint: string,
    historyRef: HistoryRef,
    context: MarketContext,
    history: HistoryEntry[],
): Promise<ShouldBuyWithBuyPredictionResponse> {
    const corePredictPromise = shouldBuyWithPredictionBase(p, mint, historyRef, context, history);

    if (!p.deps.downsidePredictor) {
        return corePredictPromise;
    }

    const downsideExecutionMode = p.config.buy.downsideProtection!.executionMode;

    let corePredictionRes: ShouldBuyWithPredictionBaseResponse | undefined;
    let downsidePredictorRes: DownsidePredictorResponse | undefined;
    let predictedDownsideConfidence: number | null = null;

    if (downsideExecutionMode === 'always') {
        [corePredictionRes, downsidePredictorRes] = await Promise.all([
            corePredictPromise,
            p.deps.downsidePredictor!.predict(mint, historyRef, context, history),
        ]);
    } else {
        corePredictionRes = await corePredictPromise;
    }

    let responseData: ShouldBuyResponseData = corePredictionRes.data!;

    if (downsideExecutionMode === 'always') {
        ({ predictedDownsideConfidence, responseData } = _prepareDownsideResponseData(
            p.deps.logger,
            corePredictionRes,
            downsidePredictorRes!,
            responseData,
            mint,
        ));
    }

    if (corePredictionRes.buy) {
        if (downsideExecutionMode === 'onBuyThreshold') {
            downsidePredictorRes = await p.deps.downsidePredictor!.predict(mint, historyRef, context, history);
            ({ predictedDownsideConfidence, responseData } = _prepareDownsideResponseData(
                p.deps.logger,
                corePredictionRes,
                downsidePredictorRes!,
                responseData,
                mint,
            ));
        }

        if (predictedDownsideConfidence !== null) {
            const t = downsidePredictorRes as ConfidencePredictionResponse;
            const downsidePredicted = t.confidence >= p.config.buy.downsideProtection!.minPredictedConfidence;

            return {
                buy: !downsidePredicted,
                reason: downsidePredicted ? 'downside_prediction' : corePredictionRes.reason,
                data: responseData,
            };
        } else {
            return {
                buy: false,
                reason: 'downside_prediction_error',
                data: responseData,
            };
        }
    }

    return {
        buy: false,
        reason: corePredictionRes.reason,
        data: responseData,
    };
}

type ShouldBuyWithPredictionBaseResponse = ShouldBuyResponse<
    BuyPredictionStrategyShouldBuyResponseReason,
    ShouldBuyBaseResponseData
>;

async function shouldBuyWithPredictionBase(
    shouldBuyParams: ShouldBuyParams,
    mint: string,
    historyRef: HistoryRef,
    context: MarketContext,
    history: HistoryEntry[],
): Promise<ShouldBuyWithPredictionBaseResponse> {
    const { deps, source, config, cacheBaseKey, cacheDefaultTtlSeconds, setConsecutivePredictionConfirmations } =
        shouldBuyParams;
    let consecutivePredictionConfirmations = shouldBuyParams.consecutivePredictionConfirmations;
    const { logger, client, cache } = deps;

    const r = await shouldBuyCommon(logger, mint, historyRef, context, history, config);
    if ((r as ShouldBuyResponse)?.reason) {
        return r as ShouldBuyWithBuyPredictionResponse;
    }

    const predictionResponse = await makePredictionRequest(
        client,
        cache,
        source,
        config,
        cacheBaseKey as string,
        mint,
        historyRef,
        r as PredictionRequest,
        cacheDefaultTtlSeconds,
    );

    let errorData;

    if ((predictionResponse as { ensembleError: string }).ensembleError) {
        logger.error('Error getting buy prediction for mint %s, returning false', mint);
        const ensembleError = (predictionResponse as { ensembleError: string }).ensembleError;
        logger.error(ensembleError);

        errorData = {
            error: ensembleError,
        };
    }

    if ((predictionResponse as MakePredictionRequestErrorResponse).error) {
        logger.error('Error getting buy prediction for mint %s, returning false', mint);
        logger.error((predictionResponse as MakePredictionRequestErrorResponse).error.response);

        errorData = {
            response: {
                status: (predictionResponse as MakePredictionRequestErrorResponse).error.response.status,
                body: (predictionResponse as MakePredictionRequestErrorResponse).error.response.data,
            },
        };
    }

    if (errorData) {
        return {
            buy: false,
            reason: 'prediction_error',
            data: errorData,
        };
    }

    const prediction = predictionResponse as ConfidencePredictionResponse;
    const responseData: BuyResponseSuccessData = {
        predictedBuyConfidence: prediction.confidence,
    };
    if ((prediction as ConfidencePredictionEnsembleResponse)?.status === 'ensemble_success') {
        responseData.aggregationMode = (prediction as ConfidencePredictionEnsembleResponse).aggregationMode;
        responseData.individualResults = (prediction as ConfidencePredictionEnsembleResponse).individualResults;
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

function _prepareDownsideResponseData(
    logger: Logger,
    corePredictionRes: ShouldBuyWithPredictionBaseResponse,
    downsidePredictorRes: DownsidePredictorResponse,
    responseData: ShouldBuyResponseData,
    mint: string,
): {
    responseData: ShouldBuyResponseData;
    predictedDownsideConfidence: number | null;
} {
    let predictedDownsideConfidence: number | null = null;
    let predictionDownsideErrorData;

    if ((downsidePredictorRes as ConfidencePredictionResponse).confidence) {
        predictedDownsideConfidence = (downsidePredictorRes as ConfidencePredictionResponse).confidence;

        const downsideSuccessData: DownsideResponseSuccessData = {
            predictedConfidence: predictedDownsideConfidence,
        };
        if ((downsidePredictorRes as ConfidencePredictionEnsembleResponse).individualResults) {
            downsideSuccessData.aggregationMode = (
                downsidePredictorRes as ConfidencePredictionEnsembleResponse
            ).aggregationMode;
            downsideSuccessData.individualResults = (
                downsidePredictorRes as ConfidencePredictionEnsembleResponse
            ).individualResults;
        }

        if (corePredictionRes.data) {
            responseData = {
                ...corePredictionRes.data,
                downside: downsideSuccessData,
            };
        }
    } else if ((downsidePredictorRes as MakePredictionRequestErrorResponse).error) {
        const err = (downsidePredictorRes as MakePredictionRequestErrorResponse).error;
        predictionDownsideErrorData = {
            status: err.response.status,
            body: err.response.data,
        };
    } else if ((downsidePredictorRes as MakePredictionRequestEnsembleErrorResponse).ensembleError) {
        predictionDownsideErrorData = downsidePredictorRes as MakePredictionRequestEnsembleErrorResponse;
    } else if ((downsidePredictorRes as PredictorNotStartReason).stopReason) {
        responseData = {
            ...responseData,
            downside: {
                notStartReason: (downsidePredictorRes as PredictorNotStartReason).stopReason,
            },
        };
    }

    if (predictionDownsideErrorData) {
        logger.error('Error getting downside prediction for mint %s, returning false', mint);
        logger.error('Error reason reason=%o', predictionDownsideErrorData);
        responseData = {
            ...responseData,
            downside: {
                response: predictionDownsideErrorData,
            },
        };
    }

    return {
        responseData: responseData,
        predictedDownsideConfidence,
    };
}

export type ShouldSellParams = {
    deps: PredictStrategyDependencies;
    source: PredictionSource;
    config: {
        prediction: PredictionConfig;
        sell: BuySellPredictionStrategyConfig['sell'];
    };
    cacheBaseKey: string | string[];
    cacheDefaultTtlSeconds?: number;
    consecutivePredictionConfirmations: number;
    setConsecutivePredictionConfirmations: (value: number) => number;
};

type SellResponseSuccessData = {
    predictedSellConfidence: number;
    consecutivePredictionConfirmations?: number;
    aggregationMode?: AggregationMode;
    individualResults?: ConfidencePredictionEnsembleResponse['individualResults'];
};

export async function shouldSellPredicted(
    shouldSellParams: ShouldSellParams,
    mint: string,
    historyRef: HistoryRef,
    _context: MarketContext,
    history: HistoryEntry[],
): Promise<
    ShouldSellResponse<
        BuySellPredictionStrategyShouldSellResponseReason,
        PredictionErrorData | { error: string } | SellResponseSuccessData
    >
> {
    const { deps, source, config, cacheBaseKey, cacheDefaultTtlSeconds, setConsecutivePredictionConfirmations } =
        shouldSellParams;
    let consecutivePredictionConfirmations = shouldSellParams.consecutivePredictionConfirmations;
    const { logger, client, cache } = deps;

    if (history.length < config.prediction.requiredFeaturesLength) {
        return {
            sell: false,
            reason: 'requiredFeaturesLength',
        };
    }

    const r = formPredictionRequest(logger, config, mint, history);
    if ((r as unknown as { reason: FormPredictionRequestFailReason }).reason) {
        return {
            sell: false,
            reason: (r as unknown as { reason: FormPredictionRequestFailReason }).reason,
        };
    }

    const predictionResponse = await makePredictionRequest(
        client,
        cache,
        source,
        config,
        cacheBaseKey as string,
        mint,
        historyRef,
        r as PredictionRequest,
        cacheDefaultTtlSeconds,
    );

    let errorData;

    if ((predictionResponse as { ensembleError: string }).ensembleError) {
        logger.error('Error getting sell prediction for mint %s, returning false', mint);
        const ensembleError = (predictionResponse as { ensembleError: string }).ensembleError;
        logger.error(ensembleError);

        errorData = {
            error: ensembleError,
        };
    }

    if ((predictionResponse as MakePredictionRequestErrorResponse).error) {
        logger.error('Error getting sell prediction for mint %s, returning false', mint);
        logger.error((predictionResponse as MakePredictionRequestErrorResponse).error.response);

        errorData = {
            response: {
                status: (predictionResponse as MakePredictionRequestErrorResponse).error.response.status,
                body: (predictionResponse as MakePredictionRequestErrorResponse).error.response.data,
            },
        };
    }

    if (errorData) {
        return {
            sell: false,
            reason: 'prediction_error',
            data: errorData,
        };
    }

    const prediction = predictionResponse as ConfidencePredictionResponse;
    const responseData: SellResponseSuccessData = {
        predictedSellConfidence: prediction.confidence,
    };
    if ((prediction as ConfidencePredictionEnsembleResponse)?.status === 'ensemble_success') {
        responseData.aggregationMode = (prediction as ConfidencePredictionEnsembleResponse).aggregationMode;
        responseData.individualResults = (prediction as ConfidencePredictionEnsembleResponse).individualResults;
    }

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
    prediction: PredictionConfig,
    source: Omit<SinglePredictionSource, 'endpoint'>,
): string {
    const pc = prediction.skipAllSameFeatures !== undefined ? `skf:${prediction.skipAllSameFeatures}` : '';
    return `${predictionTypeAbbreviation[predictionType]}p.${source.algorithm[0]}_${source.model}${pc.length === 0 ? '' : `_${pc}`}`;
}
