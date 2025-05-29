import { AxiosResponse } from 'axios';
import redisMock from 'ioredis-mock';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryRef } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import PredictionStrategy, {
    PredictPricesRequest,
    PredictionSource,
    PredictionStrategyConfig,
} from '../../../../../src/trading/strategies/launchpads/PredictionStrategy';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe('PredictionStrategy', () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const redisMockInstance = new redisMock();
    const sourceConfig: PredictionSource = {
        model: 'test_rsi7',
        endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
    };
    const config = {
        requiredFeaturesLength: 10,
        buy: {
            minPredictedPriceIncreasePercentage: 15,
        },
    };
    let strategy: PredictionStrategy;

    const historyRef: HistoryRef = {
        timestamp: 1740056426861,
        index: 10,
    };

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, config);
    });

    afterEach(() => {
        mockServer.resetHandlers();
        redisMockInstance.flushall();
    });

    afterAll(() => {
        mockServer.close();
    });

    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';

    const history: HistoryEntry[] = readFixture<{ history: HistoryEntry[] }>(
        'backtest/pumpfun/B6eQdRcdYhuFxXKx75jumoMGkZCE4LCeobSDgZNzpump',
    ).history;

    const dummyApiSuccessResponse = {
        predicted_prices: [
            1.890614874462375e-7, 1.990614874462375e-7, 2.110614874462375e-7, 2.120614874462375e-7,
            2.1931132543763547e-7,
        ],
    };

    describe('shouldBuy', () => {
        const mswPredictPriceWillIncreaseHandler = http.post(
            process.env.PRICE_PREDICTION_ENDPOINT as string,
            async ({ request }) => {
                const body = await request.json();
                if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                    return HttpResponse.json({}, { status: 400 });
                }

                return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
            },
        );

        it('should buy when predicted price exceeds threshold for required consecutive confirmations', async () => {
            mockServer.use(mswPredictPriceWillIncreaseHandler);
            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: true,
                reason: 'consecutivePredictionConfirmations',
                data: {
                    lastNextPrice: 2.1931132543763547e-7,
                    lastNextVariance: null,
                },
            });
        });

        it('should not buy when predicted price increases with the expected threshold but consecutivePredictionConfirmations is less than required consecutive confirmations', async () => {
            strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                ...config,
                buy: { ...config.buy, minConsecutivePredictionConfirmations: 3 },
            });

            const indexesWithLowPrice = [2];
            let callCount = 0;
            mockServer.use(
                http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            // return price less than expected increase only for the specified indexes to test the consecutive check
                            predicted_prices: [
                                indexesWithLowPrice.includes(callCount++)
                                    ? 1.890614874462375e-7
                                    : 2.1931132543763547e-7,
                            ],
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
                    reason: indexesWithLowPrice.includes(i)
                        ? 'minPredictedPriceIncreasePercentage'
                        : 'consecutivePredictionConfirmations',
                    data: {
                        lastNextPrice: indexesWithLowPrice.includes(i) ? 1.890614874462375e-7 : 2.1931132543763547e-7,
                        lastNextVariance: null,
                    },
                });
            }
        });

        describe('should send the correct features length in the HTTP request', () => {
            it('should return false and make no HTTP call if the min required features length is not met', async () => {
                expect(await strategy.shouldBuy(mint, historyRef, history[4], [history[4]])).toEqual({
                    buy: false,
                    reason: 'requiredFeaturesLength',
                });
            });

            it('should send upToFeaturesLength features when it is less than history length', async () => {
                strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                    ...config,
                    upToFeaturesLength: 380,
                });
                mockServer.use(
                    http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                        const body = (await request.json()) as PredictPricesRequest;
                        if (body.features.length !== 380) {
                            return HttpResponse.json({}, { status: 400 });
                        }

                        return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
                    }),
                );

                expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                    buy: true,
                    reason: 'consecutivePredictionConfirmations',
                    data: {
                        lastNextPrice: 2.1931132543763547e-7,
                        lastNextVariance: null,
                    },
                });
            });

            it('should send all available features when history is shorter than upToFeaturesLength', async () => {
                strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                    ...config,
                    upToFeaturesLength: 2000,
                });
                mockServer.use(
                    http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                        const body = (await request.json()) as PredictPricesRequest;
                        if (body.features.length !== 1256) {
                            return HttpResponse.json({}, { status: 400 });
                        }

                        return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
                    }),
                );

                expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                    buy: true,
                    reason: 'consecutivePredictionConfirmations',
                    data: {
                        lastNextPrice: 2.1931132543763547e-7,
                        lastNextVariance: null,
                    },
                });
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
                    await strategy.shouldBuy(mint, historyRef, historyWithoutVariation[33], historyWithoutVariation),
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

            it('should make HTTP request even if all features are the same when skipAllSameFeatures is false', async () => {
                strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                    ...config,
                    skipAllSameFeatures: false,
                });

                mockServer.use(
                    http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                        const body = (await request.json()) as PredictPricesRequest;
                        if (body.features.length !== 10) {
                            return HttpResponse.json({}, { status: 400 });
                        }

                        return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
                    }),
                );

                expect(
                    await strategy.shouldBuy(mint, historyRef, historyWithoutVariation[33], historyWithoutVariation),
                ).toEqual({
                    buy: true,
                    reason: 'consecutivePredictionConfirmations',
                    data: {
                        lastNextPrice: 2.1931132543763547e-7,
                        lastNextVariance: null,
                    },
                });
            });
        });

        it('should not buy when the predicted price increases with the expected threshold and context limits do not match', async () => {
            mockServer.use(mswPredictPriceWillIncreaseHandler);
            strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                requiredFeaturesLength: 10,
                buy: {
                    minPredictedPriceIncreasePercentage: 15,
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

        it('should not buy when the last predicted price is below the defined threshold', async () => {
            mockServer.use(
                http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            predicted_prices: [
                                1.890614874462375e-7,
                                1.990614874462375e-7,
                                2.110614874462375e-7,
                                2.120614874462375e-7,
                                1.890614874462375e-7 * (1 + strategy.config.buy.minPredictedPriceIncreasePercentage) -
                                    0.1,
                            ],
                        },
                        { status: 200 },
                    );
                }),
            );

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedPriceIncreasePercentage',
                data: {
                    lastNextPrice: -0.09999697501620086,
                    lastNextVariance: null,
                },
            });
        });

        it('should log error and return false when it fails to get the predicted prices', async () => {
            mockServer.use(
                http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async () => {
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
                    'Error getting price prediction for mint 2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx, returning false',
            });
            expect(logs[1].level).toEqual('error');
            expect((logs[1].message as unknown as AxiosResponse).data).toEqual({
                error: 'for fun',
            });
        });

        it('should use the cache correctly', async () => {
            strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                ...config,
                buy: {
                    ...config.buy,
                    minPredictedPriceIncreasePercentage: 1e3,
                },
            });

            let callCount = 0;
            mockServer.use(
                http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async () => {
                    if (callCount++ === 0) {
                        return HttpResponse.json(
                            {
                                predicted_prices: [1.890614874462375e-7],
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
                reason: 'minPredictedPriceIncreasePercentage',
                data: {
                    lastNextPrice: 1.890614874462375e-7,
                    lastNextVariance: null,
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
                'p.test_rsi7_skf:true_rql:10_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10':
                    '{"predicted_prices":[1.890614874462375e-7]}',
            });

            expect(await strategy.shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedPriceIncreasePercentage',
                data: {
                    lastNextPrice: 1.890614874462375e-7,
                    lastNextVariance: null,
                },
            });
            expect(callCount).toBe(1);
        });
    });

    describe('formVariant', () => {
        function getVariant(customConfig: Partial<PredictionStrategyConfig> = {}) {
            return new PredictionStrategy(logger, redisMockInstance, sourceConfig, customConfig).config.variant;
        }

        it('should full variant key with all values', () => {
            const key = getVariant({
                skipAllSameFeatures: false,
                requiredFeaturesLength: 3,
                upToFeaturesLength: 5,
                buy: {
                    minPredictedPriceIncreasePercentage: 10,
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
                'test_rsi7_b(skf:false_rql:3_upfl:5)_buy(mppip:10_mcpc:3_c(hc:l1-h2_mc:l2-h77))_sell(tpp:10_tslp:15_slp:33_ttp(pp:30:sp:5))',
            );
        });

        it('should exclude undefined values and use model defaults', () => {
            const key = getVariant({
                upToFeaturesLength: undefined,
                buy: {
                    minPredictedPriceIncreasePercentage: 15,
                },
                sell: {
                    takeProfitPercentage: 17,
                },
            });
            expect(key).toBe('test_rsi7_b(skf:true_rql:10)_buy(mppip:15)_sell(tpp:17)');
        });
    });

    describe('formBaseCacheKey', () => {
        const sourceConfig: PredictionSource = {
            endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
            model: 'm1',
        };
        const defaultConfig: Partial<PredictionStrategyConfig> = {
            skipAllSameFeatures: false,
            requiredFeaturesLength: 3,
            upToFeaturesLength: 5,
            buy: {
                minPredictedPriceIncreasePercentage: 100,
            },
        };

        function getKeyFromConfig(customConfig: Partial<PredictionStrategyConfig> = {}) {
            const strategy = new PredictionStrategy(logger, redisMockInstance, sourceConfig, {
                ...defaultConfig,
                ...customConfig,
            });
            return (strategy as unknown as { formBaseCacheKey: () => string }).formBaseCacheKey();
        }

        it('should generate full cache key with all values', () => {
            const key = getKeyFromConfig();
            expect(key).toBe('p.m1_skf:false_rql:3_upfl:5');
        });

        it('should exclude undefined values from the cache key', () => {
            const key = getKeyFromConfig({
                variant: undefined,
                skipAllSameFeatures: undefined,
            });
            expect(key).toBe('p.m1_rql:3_upfl:5');
        });

        it('should handle boolean true correctly', () => {
            const key = getKeyFromConfig({ skipAllSameFeatures: true });
            expect(key).toContain('_skf:true');
            expect(key).toBe('p.m1_skf:true_rql:3_upfl:5');
        });

        it('should handle boolean false correctly', () => {
            const key = getKeyFromConfig({ skipAllSameFeatures: false });
            expect(key).toContain('_skf:false');
            expect(key).toBe('p.m1_skf:false_rql:3_upfl:5');
        });

        it('should return only model prefix if everything else is undefined', () => {
            const key = getKeyFromConfig({
                variant: undefined,
                skipAllSameFeatures: undefined,
                requiredFeaturesLength: undefined,
                upToFeaturesLength: undefined,
            });
            expect(key).toBe('p.m1');
        });
    });
});
