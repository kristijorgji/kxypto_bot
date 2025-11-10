import { AxiosResponse } from 'axios';
import Redis from 'ioredis';
import { HttpResponse, http } from 'msw';
import { SetupServerApi } from 'msw/node';
import { LogEntry } from 'winston';

import { buyEnsemblePredictionSource, sellEnsemblePredictionSource } from './data';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { HistoryRef, ShouldBuyResponse } from '../../../../../src/trading/bots/types';
import { BuyPredictionStrategyConfig } from '../../../../../src/trading/strategies/launchpads/BuyPredictionStrategy';
import BuySellPredictionStrategy from '../../../../../src/trading/strategies/launchpads/BuySellPredictionStrategy';
import LaunchpadBotStrategy from '../../../../../src/trading/strategies/launchpads/LaunchpadBotStrategy';
import {
    ConfidencePredictionResponse,
    PredictionSource,
    SinglePredictionSource,
    StrategyPredictionConfig,
} from '../../../../../src/trading/strategies/types';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readLocalFixture } from '../../../../__utils/data';

import Mock = jest.Mock;

export const formMswPredictionRequestHandler = (p: {
    endpoint: string;
    mockHandler?: Mock;
    matchesRequestBody?: Record<string, unknown>;
    matchesLocalFixture?: string;
    response?: ConfidencePredictionResponse;
    error?: string;
}) =>
    http.post(p.endpoint, async ({ request }) => {
        if (p.mockHandler) {
            p.mockHandler(request);
        }

        if (p.error) {
            return HttpResponse.json(
                {
                    error: p.error,
                },
                { status: 400 },
            );
        }

        const body = await request.json();
        const expectedBody =
            p.matchesRequestBody ?? readLocalFixture(p?.matchesLocalFixture ?? 'prediction-strategy-http-request-1');
        if (!deepEqual(body, expectedBody)) {
            return HttpResponse.json(
                {
                    error: 'msw_does not match expected request body',
                },
                { status: 400 },
            );
        }

        return HttpResponse.json(p.response, { status: 200 });
    });

export function defineShouldBuyWithPredictionTests({
    mockServer,
    redisMockInstance,
    predictionEndpoint,
    getLogs,
    getStrategy,
    formStrategy,
    mint,
    historyRef,
    history,
}: {
    mockServer: SetupServerApi;
    redisMockInstance: Redis;
    predictionEndpoint: string;
    getLogs: () => LogEntry[];
    getStrategy: () => LaunchpadBotStrategy;
    formStrategy: (overrides: {
        source?: PredictionSource;
        prediction?: Partial<StrategyPredictionConfig>;
        buy?: Partial<BuyPredictionStrategyConfig['buy']>;
    }) => void;
    mint: string;
    historyRef: HistoryRef;
    history: HistoryEntry[];
}) {
    describe('shouldBuy', () => {
        const mswPredictAboveThresholdBuyHandler = formMswPredictionRequestHandler({
            endpoint: predictionEndpoint,
            response: {
                status: 'single_model_success',
                confidence: 0.51,
            },
        });

        const mswPredictBelowThresholdBuyHandler = formMswPredictionRequestHandler({
            endpoint: predictionEndpoint,
            response: {
                status: 'single_model_success',
                confidence: 0.49,
            },
        });

        const mswPredictThrowErrorBuyHandler = formMswPredictionRequestHandler({
            endpoint: predictionEndpoint,
            error: 'for fun',
        });

        it('should buy when predicted confidence exceeds threshold for required consecutive confirmations and not use cache', async () => {
            mockServer.use(mswPredictAboveThresholdBuyHandler);
            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: true,
                reason: 'consecutivePredictionConfirmations',
                data: {
                    predictedBuyConfidence: 0.51,
                    consecutivePredictionConfirmations: 1,
                },
            } satisfies ShouldBuyResponse);
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({});
        });

        it('should not buy when predicted confidence increases with the expected threshold but consecutivePredictionConfirmations is less than required consecutive confirmations', async () => {
            formStrategy({
                buy: { minConsecutivePredictionConfirmations: 3 },
            });

            const indexesWithLowerThanThresholdConfidence = [2];
            let callCount = 0;
            mockServer.use(
                http.post(predictionEndpoint, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            // return confidence less than expected increase only for the specified indexes to test the consecutive check
                            confidence: indexesWithLowerThanThresholdConfidence.includes(callCount++) ? 0.49 : 0.53,
                        },
                        { status: 200 },
                    );
                }),
            );

            let consecutiveReached = 0;
            for (let i = 0; i < 6; i++) {
                if (indexesWithLowerThanThresholdConfidence.includes(i)) {
                    consecutiveReached = 0;
                } else {
                    consecutiveReached++;
                }

                expect(
                    await getStrategy().shouldBuy(
                        mint,
                        {
                            ...historyRef,
                            index: i,
                        },
                        history[4],
                        history,
                    ),
                ).toEqual({
                    buy: i === 5,
                    reason: indexesWithLowerThanThresholdConfidence.includes(i)
                        ? 'minPredictedBuyConfidence'
                        : 'consecutivePredictionConfirmations',
                    data: {
                        predictedBuyConfidence: indexesWithLowerThanThresholdConfidence.includes(i) ? 0.49 : 0.53,
                        consecutivePredictionConfirmations: indexesWithLowerThanThresholdConfidence.includes(i)
                            ? undefined
                            : consecutiveReached,
                    },
                } satisfies ShouldBuyResponse);
            }
        });

        it('should not buy and call prediction endpoint when context limits do not match', async () => {
            formStrategy({
                prediction: {
                    requiredFeaturesLength: 10,
                },
                buy: {
                    minPredictedConfidence: 0.5,
                    context: {
                        holdersCount: {
                            min: 17,
                        },
                    },
                },
            });

            const endpointHandler = jest.fn();
            mockServer.use(
                http.post(predictionEndpoint, async () => {
                    endpointHandler();
                    throw new Error('should not be called');
                }),
            );

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'shouldBuyStateless',
            } satisfies ShouldBuyResponse);
            expect(endpointHandler).not.toHaveBeenCalled();
        });

        it('should not buy when the predicted confidence is below the defined threshold', async () => {
            mockServer.use(mswPredictBelowThresholdBuyHandler);

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.49,
                },
            } satisfies ShouldBuyResponse);
        });

        it('should log error and return false when it fails to get the predicted confidence', async () => {
            mockServer.use(mswPredictThrowErrorBuyHandler);

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'prediction_error',
                data: { response: { status: 400, body: { error: 'for fun' } } },
            } satisfies ShouldBuyResponse);
            expect(getLogs().length).toEqual(2);
            expect(getLogs()[0]).toEqual({
                level: 'error',
                message:
                    'Error getting buy prediction for mint 2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx, returning false',
            });
            expect(getLogs()[1].level).toEqual('error');
            expect((getLogs()[1].message as unknown as AxiosResponse).data).toEqual({
                error: 'for fun',
            });
        });

        it('should use the cache correctly', async () => {
            formStrategy({
                prediction: {
                    cache: {
                        enabled: true,
                    },
                },
                buy: {
                    minPredictedConfidence: 0.7,
                },
            });

            let callCount = 0;
            mockServer.use(
                http.post(predictionEndpoint, async () => {
                    if (callCount++ === 0) {
                        return HttpResponse.json(
                            {
                                confidence: 0.2,
                            },
                            { status: 200 },
                        );
                    } else {
                        return HttpResponse.json({ error: 'a second call was not expected' }, { status: 400 });
                    }
                }),
            );

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.2,
                },
            } satisfies ShouldBuyResponse);
            expect(callCount).toBe(1);
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({
                'bp.t_test_rsi7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10': '{"confidence":0.2}',
            });

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.2,
                },
            } satisfies ShouldBuyResponse);
            expect(callCount).toBe(1);
        });

        it('should throw error if the confidence is missing from the response body', async () => {
            mockServer.use(
                http.post(predictionEndpoint, async () => {
                    return HttpResponse.json(
                        {
                            lol: true,
                        },
                        { status: 200 },
                    );
                }),
            );

            await expect(getStrategy().shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('The response is missing the required field confidence. {"lol":true}'),
            );
        });

        it('should throw error if the returned confidence is outside the interval [0, 1]', async () => {
            mockServer.use(
                http.post(predictionEndpoint, () =>
                    HttpResponse.json(
                        {
                            confidence: -0.1,
                        },
                        { status: 200 },
                    ),
                ),
            );
            await expect(getStrategy().shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got -0.1'),
            );

            mockServer.use(
                http.post(predictionEndpoint, () =>
                    HttpResponse.json(
                        {
                            confidence: 1.0001,
                        },
                        { status: 200 },
                    ),
                ),
            );
            await expect(getStrategy().shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got 1.0001'),
            );
        });

        describe('with downsideProtection', () => {
            const downsideProtectionConfig: BuyPredictionStrategyConfig['buy']['downsideProtection'] = {
                executionMode: 'always',
                source: {
                    algorithm: 'transformers',
                    model: 'drop_30',
                    endpoint: 'http://localhost:8080/d/drop-30',
                },
                minPredictedConfidence: 0.17,
                prediction: {
                    skipAllSameFeatures: true,
                    requiredFeaturesLength: 10,
                    cache: {
                        enabled: true,
                    },
                },
            };

            const mswDownsidePredictBelowThresholdHandler = formMswPredictionRequestHandler({
                endpoint: (downsideProtectionConfig.source as SinglePredictionSource).endpoint,
                response: {
                    status: 'single_model_success',
                    confidence: downsideProtectionConfig.minPredictedConfidence - 0.1,
                },
            });

            const mswDownsidePredictAboveThresholdHandler = formMswPredictionRequestHandler({
                endpoint: (downsideProtectionConfig.source as SinglePredictionSource).endpoint,
                response: {
                    status: 'single_model_success',
                    confidence: downsideProtectionConfig.minPredictedConfidence + 0.2,
                },
            });

            beforeEach(() => {
                formStrategy({
                    buy: {
                        downsideProtection: downsideProtectionConfig,
                    },
                });
            });

            async function assertBuysWhenBuyPredMeetsAndNoDownsidePredicted(): Promise<void> {
                mockServer.use(mswPredictAboveThresholdBuyHandler);
                mockServer.use(mswDownsidePredictBelowThresholdHandler);

                expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                    buy: true,
                    reason: 'consecutivePredictionConfirmations',
                    data: {
                        predictedBuyConfidence: 0.51,
                        consecutivePredictionConfirmations: 1,
                        downside: {
                            predictedConfidence: 0.07,
                        },
                    },
                } satisfies ShouldBuyResponse);

                const expectedCache: Record<string, string> = {
                    'sp.t_drop_30_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10':
                        '{"status":"single_model_success","confidence":0.07}',
                };
                if (getStrategy() instanceof BuySellPredictionStrategy) {
                    expectedCache['bp.t_test_rsi7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10'] =
                        '{"status":"single_model_success","confidence":0.51}';
                }
                expect(
                    Object.fromEntries(
                        await Promise.all(
                            (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                        ),
                    ),
                ).toEqual(expectedCache);
            }

            describe('with executionMode=always', () => {
                it('should not buy when buyPred meets but a downsideProtection is predicted', async () => {
                    mockServer.use(mswPredictAboveThresholdBuyHandler);
                    mockServer.use(mswDownsidePredictAboveThresholdHandler);

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'downside_prediction',
                        data: {
                            predictedBuyConfidence: 0.51,
                            consecutivePredictionConfirmations: 1,
                            downside: {
                                predictedConfidence: 0.37,
                            },
                        },
                    } satisfies ShouldBuyResponse);

                    const expectedCache: Record<string, string> = {
                        'sp.t_drop_30_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10':
                            '{"status":"single_model_success","confidence":0.37}',
                    };
                    if (getStrategy() instanceof BuySellPredictionStrategy) {
                        expectedCache['bp.t_test_rsi7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10'] =
                            '{"status":"single_model_success","confidence":0.51}';
                    }
                    expect(
                        Object.fromEntries(
                            await Promise.all(
                                (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                            ),
                        ),
                    ).toEqual(expectedCache);
                });

                it('should not buy when buyPred does not meet and a downside is not predicted', async () => {
                    mockServer.use(mswPredictBelowThresholdBuyHandler);
                    mockServer.use(mswDownsidePredictBelowThresholdHandler);

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'minPredictedBuyConfidence',
                        data: {
                            predictedBuyConfidence: 0.49,
                            downside: {
                                predictedConfidence: 0.07,
                            },
                        },
                    } satisfies ShouldBuyResponse);
                });

                it('should not buy when buyPred call fails and a downside is not predicted', async () => {
                    mockServer.use(mswPredictThrowErrorBuyHandler);
                    mockServer.use(mswDownsidePredictBelowThresholdHandler);

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'prediction_error',
                        data: {
                            downside: {
                                predictedConfidence: 0.07,
                            },
                            response: {
                                body: {
                                    error: 'for fun',
                                },
                                status: 400,
                            },
                        },
                    } satisfies ShouldBuyResponse);
                });

                it('should buy when buyPred meets and no downsideProtection is predicted', async () => {
                    await assertBuysWhenBuyPredMeetsAndNoDownsidePredicted();
                });

                it('should not buy when buyPred meets and downsidePrediction call fails', async () => {
                    mockServer.use(mswPredictAboveThresholdBuyHandler);
                    mockServer.use(
                        http.post((downsideProtectionConfig.source as SinglePredictionSource).endpoint, async () => {
                            return HttpResponse.json(
                                {
                                    error: 'for fun',
                                },
                                { status: 400 },
                            );
                        }),
                    );

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'downside_prediction_error',
                        data: {
                            predictedBuyConfidence: 0.51,
                            consecutivePredictionConfirmations: 1,
                            downside: {
                                response: {
                                    body: {
                                        error: 'for fun',
                                    },
                                    status: 400,
                                },
                            },
                        },
                    } satisfies ShouldBuyResponse);
                });
            });

            describe('with executionMode=onBuyThreshold', () => {
                const downsideProtectionConfigWithOnBuyThreshold: BuyPredictionStrategyConfig['buy']['downsideProtection'] =
                    {
                        ...downsideProtectionConfig,
                        executionMode: 'onBuyThreshold',
                    };
                beforeEach(() => {
                    formStrategy({
                        buy: {
                            downsideProtection: downsideProtectionConfigWithOnBuyThreshold,
                        },
                    });
                });

                it('should call downside when buyPred meets', async () => {
                    await assertBuysWhenBuyPredMeetsAndNoDownsidePredicted();
                });

                it('should not call downside prediction when buy prediction is false', async () => {
                    mockServer.use(mswPredictBelowThresholdBuyHandler);

                    const downsidePredictionHandlerMockFn = jest.fn();
                    mockServer.use(
                        formMswPredictionRequestHandler({
                            endpoint: (downsideProtectionConfig.source as SinglePredictionSource).endpoint,
                            mockHandler: downsidePredictionHandlerMockFn,
                        }),
                    );

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'minPredictedBuyConfidence',
                        data: {
                            predictedBuyConfidence: 0.49,
                        },
                    } satisfies ShouldBuyResponse);
                    expect(downsidePredictionHandlerMockFn).toHaveBeenCalledTimes(0);

                    const expectedCache: Record<string, string> = {};
                    if (getStrategy() instanceof BuySellPredictionStrategy) {
                        expectedCache['bp.t_test_rsi7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10'] =
                            '{"status":"single_model_success","confidence":0.49}';
                    }
                    expect(
                        Object.fromEntries(
                            await Promise.all(
                                (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                            ),
                        ),
                    ).toEqual(expectedCache);
                });
            });

            describe('with ensemble prediction source, not buy as predictedDownside is more than threshold', () => {
                beforeEach(() => {
                    formStrategy({
                        buy: {
                            downsideProtection: {
                                ...downsideProtectionConfig,
                                source: sellEnsemblePredictionSource,
                            },
                        },
                    });

                    mockServer.use(mswPredictAboveThresholdBuyHandler);
                });

                it('works with ensemble prediction source', async () => {
                    mockServer.use(
                        formMswPredictionRequestHandler({
                            endpoint: sellEnsemblePredictionSource.sources[0].endpoint,
                            response: {
                                status: 'single_model_success',
                                confidence: 0.3,
                            },
                        }),
                    );
                    mockServer.use(
                        formMswPredictionRequestHandler({
                            endpoint: sellEnsemblePredictionSource.sources[1].endpoint,
                            response: {
                                status: 'single_model_success',
                                confidence: 0.9,
                            },
                        }),
                    );

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'downside_prediction',
                        data: {
                            consecutivePredictionConfirmations: 1,
                            downside: {
                                predictedConfidence: 0.66,
                                aggregationMode: 'weighted',
                                individualResults: [
                                    {
                                        algorithm: 'catboost',
                                        confidence: 0.3,
                                        endpoint: 'http://localhost:3878/sell/cat/7',
                                        model: '7',
                                        weight: 0.4,
                                    },
                                    {
                                        algorithm: 'transformers',
                                        confidence: 0.9,
                                        endpoint: 'http://localhost:3878/sell/transformers/v7',
                                        model: 'supra_transformers_v7',
                                        weight: 0.6,
                                    },
                                ],
                            },
                            predictedBuyConfidence: 0.51,
                        },
                    } satisfies ShouldBuyResponse);
                });

                it('should handle ensemble error', async () => {
                    mockServer.use(
                        formMswPredictionRequestHandler({
                            endpoint: sellEnsemblePredictionSource.sources[0].endpoint,
                            response: {
                                status: 'single_model_success',
                                confidence: 0.51,
                            },
                        }),
                    );
                    mockServer.use(
                        formMswPredictionRequestHandler({
                            endpoint: sellEnsemblePredictionSource.sources[1].endpoint,
                            error: 'i failed master',
                        }),
                    );

                    expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                        buy: false,
                        reason: 'downside_prediction_error',
                        data: {
                            consecutivePredictionConfirmations: 1,
                            downside: {
                                response: {
                                    ensembleError:
                                        '[http://localhost:3878/sell/transformers/v7] - 400: {"error":"i failed master"}',
                                },
                            },
                            predictedBuyConfidence: 0.51,
                        },
                    } satisfies ShouldBuyResponse);
                });
            });
        });
    });

    describe('shouldBuy works with ensemble mode', () => {
        it('aggregates the 2 model responses and uses stores in separate cache for each model', async () => {
            formStrategy({
                source: buyEnsemblePredictionSource,
                prediction: {
                    cache: {
                        enabled: true,
                    },
                },
            });
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[0].endpoint,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.51,
                    },
                }),
            );
            mockServer.use(
                formMswPredictionRequestHandler({
                    endpoint: buyEnsemblePredictionSource.sources[1].endpoint,
                    response: {
                        status: 'single_model_success',
                        confidence: 0.7,
                    },
                }),
            );
            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: true,
                data: {
                    aggregationMode: 'weighted',
                    consecutivePredictionConfirmations: 1,
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
                    predictedBuyConfidence: 0.5537,
                },
                reason: 'consecutivePredictionConfirmations',
            });
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({
                'bp.c_v100_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10':
                    '{"status":"single_model_success","confidence":0.51}',
                'bp.t_supra_transformers_v7_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10':
                    '{"status":"single_model_success","confidence":0.7}',
            });
        });
    });
}
