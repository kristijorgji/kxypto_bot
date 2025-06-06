import { AxiosResponse } from 'axios';
import redisMock from 'ioredis-mock';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryRef } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import BuyPredictionStrategy, {
    BuyPredictionStrategyConfig,
} from '../../../../../src/trading/strategies/launchpads/BuyPredictionStrategy';
import { PredictionSource, StrategyPredictionConfig } from '../../../../../src/trading/strategies/types';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe('BuyPredictionStrategy', () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const redisMockInstance = new redisMock();
    const sourceConfig: PredictionSource = {
        model: 'test_rsi7',
        endpoint: process.env.BUY_PREDICTION_ENDPOINT as string,
    };
    const config = {
        prediction: {
            requiredFeaturesLength: 10,
            skipAllSameFeatures: true,
        } satisfies StrategyPredictionConfig,
        buy: {
            minPredictedConfidence: 0.5,
        },
    };
    let strategy: BuyPredictionStrategy;

    const historyRef: HistoryRef = {
        timestamp: 1740056426861,
        index: 10,
    };
    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';
    const history: HistoryEntry[] = readFixture<{ history: HistoryEntry[] }>(
        'backtest/pumpfun/B6eQdRcdYhuFxXKx75jumoMGkZCE4LCeobSDgZNzpump',
    ).history;
    const dummyApiSuccessResponse = {
        confidence: 0.51,
    };

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, config);
    });

    afterEach(() => {
        mockServer.resetHandlers();
        redisMockInstance.flushall();
    });

    afterAll(() => {
        mockServer.close();
    });

    describe('constructor', () => {
        it('should fail to construct if config.prediction has missing values', () => {
            expect(
                () =>
                    new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, {
                        prediction: {} as StrategyPredictionConfig,
                    }),
            ).toThrow(new Error('requiredFeaturesLength is required;skipAllSameFeatures is required'));
        });
    });

    describe('shouldBuy', () => {
        const mswPredictAboveThresholdBuyHandler = http.post(
            process.env.BUY_PREDICTION_ENDPOINT as string,
            async ({ request }) => {
                const body = await request.json();
                if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                    return HttpResponse.json({}, { status: 400 });
                }

                return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
            },
        );

        it('should buy when predicted confidence exceeds threshold for required consecutive confirmations', async () => {
            mockServer.use(mswPredictAboveThresholdBuyHandler);
            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: true,
                reason: 'consecutivePredictionConfirmations',
                data: {
                    predictedBuyConfidence: 0.51,
                },
            });
        });

        it('should not buy when predicted confidence increases with the expected threshold but consecutivePredictionConfirmations is less than required consecutive confirmations', async () => {
            strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, {
                ...config,
                buy: { ...config.buy, minConsecutivePredictionConfirmations: 3 },
            });

            const indexesWithLowConfidence = [2];
            let callCount = 0;
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            // return confidence less than expected increase only for the specified indexes to test the consecutive check
                            confidence: indexesWithLowConfidence.includes(callCount++) ? 0.49 : 0.53,
                        },
                        { status: 200 },
                    );
                }),
            );

            for (let i = 0; i < 6; i++) {
                expect(
                    await strategy.shouldBuy(
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
                    reason: indexesWithLowConfidence.includes(i)
                        ? 'minPredictedBuyConfidence'
                        : 'consecutivePredictionConfirmations',
                    data: {
                        predictedBuyConfidence: indexesWithLowConfidence.includes(i) ? 0.49 : 0.53,
                    },
                });
            }
        });

        it('should not buy when the predicted confidence is within the expected threshold and context limits do not match', async () => {
            mockServer.use(mswPredictAboveThresholdBuyHandler);
            strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, {
                prediction: {
                    ...config.prediction,
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

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'shouldBuyStateless',
            });
        });

        it('should not buy when the predicted confidence is below the defined threshold', async () => {
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            confidence: 0.49,
                        },
                        { status: 200 },
                    );
                }),
            );

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.49,
                },
            });
        });

        it('should log error and return false when it fails to get the predicted confidence', async () => {
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async () => {
                    return HttpResponse.json(
                        {
                            error: 'for fun',
                        },
                        { status: 400 },
                    );
                }),
            );

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'prediction_error',
                data: { response: { status: 400, body: { error: 'for fun' } } },
            });
            expect(logs.length).toEqual(2);
            expect(logs[0]).toEqual({
                level: 'error',
                message:
                    'Error getting buy prediction for mint 2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx, returning false',
            });
            expect(logs[1].level).toEqual('error');
            expect((logs[1].message as unknown as AxiosResponse).data).toEqual({
                error: 'for fun',
            });
        });

        it('should use the cache correctly', async () => {
            strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, {
                ...config,
                buy: {
                    ...config.buy,
                    minPredictedConfidence: 0.7,
                },
            });

            let callCount = 0;
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async () => {
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

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.2,
                },
            });
            expect(callCount).toBe(1);
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({
                'bp.test_rsi7_skf:true_rql:10_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10': '{"confidence":0.2}',
            });

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.2,
                },
            });
            expect(callCount).toBe(1);
        });

        it('should throw error if the confidence is missing from the response body', async () => {
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async () => {
                    return HttpResponse.json(
                        {
                            lol: true,
                        },
                        { status: 200 },
                    );
                }),
            );

            await expect(strategy.shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('The response is missing the required field confidence. {"lol":true}'),
            );
        });

        it('should throw error if the returned confidence is outside the interval [0, 1]', async () => {
            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async () => {
                    return HttpResponse.json(
                        {
                            confidence: -0.1,
                        },
                        { status: 200 },
                    );
                }),
            );

            await expect(strategy.shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got -0.1'),
            );

            mockServer.use(
                http.post(process.env.BUY_PREDICTION_ENDPOINT as string, async () => {
                    return HttpResponse.json(
                        {
                            confidence: 1.0001,
                        },
                        { status: 200 },
                    );
                }),
            );

            await expect(strategy.shouldBuy(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got 1.0001'),
            );
        });
    });

    describe('formVariant', () => {
        function getVariant(customConfig: Partial<BuyPredictionStrategyConfig> = {}) {
            return new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, customConfig).config.variant;
        }

        it('should full variant key with all values', () => {
            const key = getVariant({
                prediction: {
                    skipAllSameFeatures: false,
                    requiredFeaturesLength: 3,
                    upToFeaturesLength: 5,
                },
                buy: {
                    minPredictedConfidence: 10,
                    minConsecutivePredictionConfirmations: 3,
                    context: {
                        holdersCount: {
                            min: 1,
                            max: 2,
                        },
                        marketCap: {
                            min: 2,
                            max: 77,
                        },
                    },
                },
                sell: {
                    takeProfitPercentage: 10,
                    trailingStopLossPercentage: 15,
                    stopLossPercentage: 33,
                    trailingTakeProfit: {
                        profitPercentage: 30,
                        stopPercentage: 5,
                    },
                },
            });
            expect(key).toBe(
                'test_rsi7_p(skf:false_rql:3_upfl:5)_buy(mpc:10_mcpc:3_c(hc:l1-h2_mc:l2-h77))_sell(tpp:10_tslp:15_slp:33_ttp(pp:30:sp:5))',
            );
        });

        it('should exclude undefined values and use model defaults', () => {
            const key = getVariant({
                prediction: {
                    requiredFeaturesLength: 10,
                    upToFeaturesLength: undefined,
                    skipAllSameFeatures: true,
                },
                buy: {
                    minPredictedConfidence: 0.5,
                },
                sell: {
                    takeProfitPercentage: 17,
                },
            });
            expect(key).toBe('test_rsi7_p(skf:true_rql:10)_buy(mpc:0.5)_sell(tpp:17)');
        });
    });

    describe('formBaseCacheKey', () => {
        const sourceConfig: PredictionSource = {
            endpoint: process.env.BUY_PREDICTION_ENDPOINT as string,
            model: 'm1',
        };
        const defaultConfig: Partial<BuyPredictionStrategyConfig> = {
            prediction: {
                skipAllSameFeatures: false,
                requiredFeaturesLength: 3,
                upToFeaturesLength: 5,
            },
            buy: {
                minPredictedConfidence: 0.7,
            },
        };

        function getKeyFromConfig(customConfig: Partial<BuyPredictionStrategyConfig> = {}, ignoreValidation = false) {
            let strategy: BuyPredictionStrategy;
            if (ignoreValidation) {
                strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, defaultConfig);
                // @ts-ignore create the strategy with the default config to pass validations, then assing ours
                strategy.config.prediction = customConfig.prediction;
            } else {
                strategy = new BuyPredictionStrategy(logger, redisMockInstance, sourceConfig, {
                    ...defaultConfig,
                    ...customConfig,
                });
            }

            return (strategy as unknown as { formBaseCacheKey: () => string }).formBaseCacheKey();
        }

        it('should generate full cache key with all values', () => {
            const key = getKeyFromConfig();
            expect(key).toBe('bp.m1_skf:false_rql:3_upfl:5');
        });

        it('should exclude undefined values from the cache key', () => {
            const key = getKeyFromConfig(
                {
                    variant: undefined,
                    prediction: {
                        ...defaultConfig.prediction,
                        // @ts-ignore
                        skipAllSameFeatures: undefined,
                    },
                },
                true,
            );
            expect(key).toBe('bp.m1_rql:3_upfl:5');
        });

        it('should handle boolean true correctly', () => {
            const key = getKeyFromConfig({
                prediction: { requiredFeaturesLength: 3, upToFeaturesLength: 5, skipAllSameFeatures: true },
            });
            expect(key).toContain('_skf:true');
            expect(key).toBe('bp.m1_skf:true_rql:3_upfl:5');
        });

        it('should handle boolean false correctly', () => {
            const key = getKeyFromConfig({
                prediction: { requiredFeaturesLength: 3, upToFeaturesLength: 5, skipAllSameFeatures: false },
            });
            expect(key).toContain('_skf:false');
            expect(key).toBe('bp.m1_skf:false_rql:3_upfl:5');
        });

        it('should return only model prefix if everything else is undefined', () => {
            const key = getKeyFromConfig(
                {
                    variant: undefined,
                    prediction: {
                        // @ts-ignore
                        skipAllSameFeatures: undefined,
                        // @ts-ignore
                        requiredFeaturesLength: undefined,
                        upToFeaturesLength: undefined,
                    },
                },
                true,
            );
            expect(key).toBe('bp.m1');
        });
    });
});
