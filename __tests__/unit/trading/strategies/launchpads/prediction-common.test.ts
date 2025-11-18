import axios from 'axios';
import redisMock from 'ioredis-mock';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import { buyEnsemblePredictionSource, sampleSinglePredictionSource } from './data';
import { formMswPredictionRequestHandler } from './shouldBuyTestCases';
import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { PredictionRequestFactory } from '../../../../../src/testdata/factories/strategies';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { HistoryRef } from '../../../../../src/trading/bots/types';
import {
    buildRemoteEnsembleSingleSource,
    formBaseCacheKey,
    makePredictionRequest,
    shouldBuyCommon,
} from '../../../../../src/trading/strategies/launchpads/prediction-common';
import {
    ConfidencePredictionResponse,
    PredictionConfig,
    PredictionRequest,
    PredictionSource,
    RemoteEnsembleMemberPredictionSource,
    RemoteEnsemblePredictionSource,
} from '../../../../../src/trading/strategies/types';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

describe('buildRemoteEnsembleSingleSource', () => {
    const baseEndpoint = 'http://127.0.0.1:8000/a/b/predict/buy/ensemble';

    it('builds correct URL with model types, names, weights and model name', async () => {
        const members: RemoteEnsembleMemberPredictionSource[] = [
            {
                algorithm: 'tabm',
                model: 'v2_fold_0',
                weight: 1,
            },
            {
                algorithm: 'tabm',
                model: 'v2_fold_1',
                weight: 2,
            },
            {
                algorithm: 'tabm',
                model: 'v2_fold_2',
                weight: 3,
            },
            {
                algorithm: 'tabm',
                model: 'v2_fold_3',
                weight: 4,
            },
            {
                algorithm: 'tabm',
                model: 'v2_fold_4',
                weight: 5.57,
            },
        ];

        expect(buildRemoteEnsembleSingleSource(baseEndpoint, members, 'weighted')).toEqual({
            algorithm: 'ensemble',
            endpoint:
                'http://127.0.0.1:8000/a/b/predict/buy/ensemble?model_types=tabm&model_names=v2_fold_0&weights=1&model_types=tabm&model_names=v2_fold_1&weights=2&model_types=tabm&model_names=v2_fold_2&weights=3&model_types=tabm&model_names=v2_fold_3&weights=4&model_types=tabm&model_names=v2_fold_4&weights=5.57&aggregation_mode=weighted',
            sources: members,
            aggregationMode: 'weighted',
            model: 'ag:weighted_[(t_v2_fold_0:w1)+(t_v2_fold_1:w2)+(t_v2_fold_2:w3)+(t_v2_fold_3:w4)+(t_v2_fold_4:w5.57)]',
        } satisfies RemoteEnsemblePredictionSource);

        expect(buildRemoteEnsembleSingleSource(baseEndpoint, members, 'mean')).toEqual({
            algorithm: 'ensemble',
            endpoint:
                'http://127.0.0.1:8000/a/b/predict/buy/ensemble?model_types=tabm&model_names=v2_fold_0&model_types=tabm&model_names=v2_fold_1&model_types=tabm&model_names=v2_fold_2&model_types=tabm&model_names=v2_fold_3&model_types=tabm&model_names=v2_fold_4&aggregation_mode=mean',
            sources: members,
            aggregationMode: 'mean',
            model: 'ag:mean_tabm_v2_fold_0_4',
        } satisfies RemoteEnsemblePredictionSource);
    });
});

describe('makePredictionRequest', () => {
    const mockServer = setupServer();
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const redisMockInstance = new redisMock();

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));
    });

    afterEach(() => {
        mockServer.resetHandlers();
        redisMockInstance.flushall();
    });

    afterAll(() => {
        mockServer.close();
    });

    const predictionConfig: PredictionConfig = {
        skipAllSameFeatures: true,
        requiredFeaturesLength: 10,
        upToFeaturesLength: 700,
        cache: {
            enabled: true,
            ttlSeconds: 3600,
        },
    };

    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';
    const predictionRequest: PredictionRequest = PredictionRequestFactory(
        {
            mint: mint,
        },
        4,
    );
    const historyRef: HistoryRef = {
        timestamp: predictionRequest.features[2].timestamp,
        index: 2,
    };

    const axiosClient = axios.create({ validateStatus: () => true });

    describe('with a single source', () => {
        it('should work and use the cache properly when enabled/disabled', async () => {
            const predictionHandlerMockFn = jest.fn();

            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: sampleSinglePredictionSource.endpoint,
                    matchesRequestBody: predictionRequest,
                    mockHandler: predictionHandlerMockFn,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.51,
                    },
                }),
            );

            const makeRequest = async (predictionConfig: PredictionConfig) =>
                await makePredictionRequest(
                    axiosClient,
                    redisMockInstance,
                    sampleSinglePredictionSource,
                    {
                        prediction: predictionConfig,
                    },
                    'bp.x_test_v7_skf:true',
                    mint,
                    historyRef,
                    predictionRequest,
                    predictionConfig.cache?.ttlSeconds ?? 1800,
                );

            const assertCache = async () =>
                expect(
                    Object.fromEntries(
                        await Promise.all(
                            (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                        ),
                    ),
                ).toEqual({
                    'bp.x_test_v7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_2:4':
                        '{"status":"single_model_success","confidence":0.51}',
                });

            const expectedResponse: ConfidencePredictionResponse = {
                status: 'single_model_success',
                confidence: 0.51,
            };

            expect(await makeRequest(predictionConfig)).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(1);

            // we call a 2nd time and expect the values to be used from cache, and no api call done
            expect(await makeRequest(predictionConfig)).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(1);

            // we call a 3rd time with cache disabled, and should have 1 more api call
            expect(
                await makeRequest({
                    ...predictionConfig,
                    cache: {
                        enabled: false,
                    },
                }),
            ).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(2);
        });
    });

    describe('with multiple sources (ensemble)', () => {
        it('aggregates properly errors, uses cache for each model when enabled/disabled', async () => {
            const predictionHandlerMockFn = jest.fn();

            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[0].endpoint,
                    matchesRequestBody: predictionRequest,
                    mockHandler: predictionHandlerMockFn,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.51,
                    },
                }),
            );
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[1].endpoint,
                    mockHandler: predictionHandlerMockFn,
                    matchesRequestBody: predictionRequest,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.7,
                    },
                }),
            );

            const makeRequest = async (predictionConfig: PredictionConfig) =>
                await makePredictionRequest(
                    axiosClient,
                    redisMockInstance,
                    buyEnsemblePredictionSource,
                    {
                        prediction: predictionConfig,
                    },
                    'bp.x_test_v7_skf:true',
                    mint,
                    historyRef,
                    predictionRequest,
                    predictionConfig.cache?.ttlSeconds ?? 1800,
                );

            const assertCache = async () =>
                expect(
                    Object.fromEntries(
                        await Promise.all(
                            (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                        ),
                    ),
                ).toEqual({
                    'b_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_2:4':
                        '{"status":"single_model_success","confidence":0.51}',
                    'p_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_2:4':
                        '{"status":"single_model_success","confidence":0.7}',
                });

            const expectedResponse: ConfidencePredictionResponse = {
                aggregationMode: 'weighted',
                confidence: 0.5537,
                individualResults: [
                    {
                        algorithm: 'catboost',
                        confidence: 0.51,
                        endpoint: 'http://localhost:3878/buy/cat/v100',
                        model: 'v100',
                        weight: 0.77,
                    },
                    {
                        algorithm: 'transformers',
                        confidence: 0.7,
                        endpoint: 'http://localhost:3878/buy/transformers/v7',
                        model: 'supra_transformers_v7',
                        weight: 0.23,
                    },
                ],
                status: 'ensemble_success',
            };

            expect(await makeRequest(predictionConfig)).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(2);

            // we call a 2nd time and expect the values to be used from cache, and no api call done
            expect(await makeRequest(predictionConfig)).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(2);

            // we call a 3rd time with cache disabled, and should have 2 more api calls
            expect(
                await makeRequest({
                    ...predictionConfig,
                    cache: {
                        enabled: false,
                    },
                }),
            ).toEqual(expectedResponse);
            await assertCache();
            expect(predictionHandlerMockFn).toHaveBeenCalledTimes(4);
        });

        it('returns error if one source faces http response with status not 200', async () => {
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[0].endpoint,
                    matchesRequestBody: predictionRequest,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.51,
                    },
                }),
            );
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[1].endpoint,
                    matchesRequestBody: predictionRequest,
                    error: 'i failed master',
                }),
            );

            expect(
                await makePredictionRequest(
                    axiosClient,
                    redisMockInstance,
                    buyEnsemblePredictionSource,
                    {
                        prediction: predictionConfig,
                    },
                    'bp.x_test_v7_skf:true',
                    mint,
                    historyRef,
                    predictionRequest,
                    predictionConfig.cache?.ttlSeconds ?? 1800,
                ),
            ).toEqual({
                ensembleError: '[http://localhost:3878/buy/transformers/v7] - 400: {"error":"i failed master"}',
            });
        });

        it('throws error if one source fails with unhandled error', async () => {
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[0].endpoint,
                    matchesRequestBody: predictionRequest,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.51,
                    },
                }),
            );
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[1].endpoint,
                    matchesRequestBody: predictionRequest,
                    response: {
                        wrongPayload: '💀',
                    } as unknown as ConfidencePredictionResponse,
                }),
            );

            await expect(
                makePredictionRequest(
                    axiosClient,
                    redisMockInstance,
                    buyEnsemblePredictionSource,
                    {
                        prediction: predictionConfig,
                    },
                    'bp.x_test_v7_skf:true',
                    mint,
                    historyRef,
                    predictionRequest,
                    predictionConfig.cache?.ttlSeconds ?? 1800,
                ),
            ).rejects.toThrow('The response is missing the required field confidence. {"wrongPayload":"💀"}');
        });
    });
});

describe(shouldBuyCommon.name, () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });

    const history: HistoryEntry[] = readFixture<{ history: HistoryEntry[] }>(
        'backtest/pumpfun/B6eQdRcdYhuFxXKx75jumoMGkZCE4LCeobSDgZNzpump',
    ).history;
    const historyRef: HistoryRef = {
        timestamp: 1740056426861,
        index: 10,
    };
    const config = {
        prediction: {
            requiredFeaturesLength: 10,
            skipAllSameFeatures: true,
        } satisfies PredictionConfig,
        buy: {},
    };

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));
    });

    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';

    describe('should send the correct features length in the HTTP request', () => {
        it('should return false and make if the min required features length is not met', async () => {
            expect(await shouldBuyCommon(logger, mint, historyRef, history[4], [history[4]], config)).toEqual({
                buy: false,
                reason: 'requiredFeaturesLength',
            });
        });

        it('should return false if buy context if required buy context does not match', async () => {
            expect(
                await shouldBuyCommon(logger, mint, historyRef, history[4], history, {
                    ...config,
                    buy: {
                        context: {
                            holdersCount: {
                                min: 1000,
                            },
                        },
                    },
                }),
            ).toEqual({
                buy: false,
                reason: 'shouldBuyStateless',
            });
        });

        it('should use upToFeaturesLength features in the formed request when it is less than history length', async () => {
            expect(
                await shouldBuyCommon(logger, mint, historyRef, history[4], history, {
                    ...config,
                    prediction: {
                        ...config.prediction,
                        upToFeaturesLength: 15,
                    },
                }),
            ).toEqual(readLocalFixture('common-prediction/should-buy-common-prediction-request-1'));
        });

        it('should return all the available features in the formed request when history is shorter than upToFeaturesLength', async () => {
            expect(
                await shouldBuyCommon(logger, mint, historyRef, history[4], history, {
                    ...config,
                    prediction: {
                        ...config.prediction,
                        upToFeaturesLength: 2000,
                    },
                }),
            ).toEqual(readLocalFixture('common-prediction/should-buy-common-prediction-request-2'));
        });
    });

    describe('uses properly skipAllSameFeatures', () => {
        const historyWithoutVariation = Array(100)
            .fill(0)
            .map((_, index) => ({
                ...history[4],
                timestamp: index + 1,
            }));

        it('should skip request and return false if all features are identical and skipping is enabled', async () => {
            expect(
                await shouldBuyCommon(
                    logger,
                    mint,
                    historyRef,
                    historyWithoutVariation[33],
                    historyWithoutVariation,
                    config,
                ),
            ).toEqual({
                buy: false,
                reason: 'noVariationInFeatures',
            });
            expect(logs).toEqual([
                {
                    level: 'debug',
                    message: 'There is no variation in the 10 features, returning false',
                },
            ]);
        });

        it('should form request even if all features are the same when skipAllSameFeatures is false', async () => {
            expect(
                await shouldBuyCommon(logger, mint, historyRef, historyWithoutVariation[33], historyWithoutVariation, {
                    ...config,
                    prediction: {
                        ...config.prediction,
                        skipAllSameFeatures: false,
                    },
                }),
            ).toEqual(readLocalFixture('common-prediction/should-buy-common-prediction-request-3'));
        });
    });
});

describe('formBaseCacheKey', () => {
    const commonSource: PredictionSource = {
        endpoint: 'http://localhost:8080',
        algorithm: 'transformers',
        model: 'transformers_v1',
    };

    it('should generate a correct cache key for "buy" type without skipAllSameFeatures', () => {
        expect(formBaseCacheKey('buy', {} as PredictionConfig, commonSource)).toBe('bp.t_transformers_v1');
    });

    it('should generate a correct cache key for "sell" type without skipAllSameFeatures', () => {
        expect(formBaseCacheKey('sell', {} as PredictionConfig, commonSource)).toBe('sp.t_transformers_v1');
    });

    it('should generate a correct cache key for "price" type without skipAllSameFeatures', () => {
        expect(formBaseCacheKey('price', {} as PredictionConfig, commonSource)).toBe('pp.t_transformers_v1');
    });

    it('should include "skf:true" when skipAllSameFeatures is true', () => {
        expect(formBaseCacheKey('buy', { skipAllSameFeatures: true } as PredictionConfig, commonSource)).toBe(
            'bp.t_transformers_v1_skf:true',
        );
    });

    it('should include "skf:false" when skipAllSameFeatures is false', () => {
        expect(formBaseCacheKey('buy', { skipAllSameFeatures: false } as PredictionConfig, commonSource)).toBe(
            'bp.t_transformers_v1_skf:false',
        );
    });

    it('should use the correct model name from source', () => {
        const customSource: PredictionSource = { ...commonSource, model: 'catboost_v2' };
        expect(formBaseCacheKey('buy', {} as PredictionConfig, customSource)).toBe('bp.t_catboost_v2');
    });

    it('should use the correct model name and algorithm and include skf when both are present', () => {
        const customSource: PredictionSource = { ...commonSource, algorithm: 'original', model: 'neural_net_prod' };
        expect(formBaseCacheKey('sell', { skipAllSameFeatures: true } as PredictionConfig, customSource)).toBe(
            'sp.o_neural_net_prod_skf:true',
        );
    });

    it('should not add underscore if pc is empty (skipAllSameFeatures undefined)', () => {
        expect(formBaseCacheKey('price', {} as PredictionConfig, commonSource)).toBe('pp.t_transformers_v1');
    });

    it('should not add underscore if pc is empty (skipAllSameFeatures is null)', () => {
        expect(
            formBaseCacheKey(
                'buy',
                {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    skipAllSameFeatures: null as any,
                } as PredictionConfig,
                commonSource,
            ),
        ).toBe('bp.t_transformers_v1_skf:null');
    });
});
