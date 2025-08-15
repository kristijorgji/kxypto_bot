import { AxiosResponse } from 'axios';
import redisMock from 'ioredis-mock';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import { defineShouldBuyWithPredictionTests } from './shouldBuyTestCases';
import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { TradeTransactionFactory } from '../../../../../src/testdata/factories/bot';
import { NewMarketContextFactory } from '../../../../../src/testdata/factories/launchpad';
import { HistoryRef } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { ShouldSellResponse } from '../../../../../src/trading/bots/types';
import BuySellPredictionStrategy, {
    BuySellPredictionStrategyConfig,
} from '../../../../../src/trading/strategies/launchpads/BuySellPredictionStrategy';
import { PredictionSource } from '../../../../../src/trading/strategies/types';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe('BuySellPredictionStrategy', () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const redisMockInstance = new redisMock();

    const buySourceConfig: PredictionSource = {
        algorithm: 'transformers',
        model: 'test_rsi7',
        endpoint: 'http://localhost/predict/buy',
    };
    const sellSourceConfig: PredictionSource = {
        algorithm: 'catboost',
        model: 'v2_30p',
        endpoint: 'http://localhost/predict/sell',
    };
    const config: Partial<BuySellPredictionStrategyConfig> = {
        prediction: {
            buy: {
                requiredFeaturesLength: 10,
                skipAllSameFeatures: true,
            },
            sell: {
                requiredFeaturesLength: 10,
                skipAllSameFeatures: true,
            },
        },
        buy: {
            minPredictedConfidence: 0.5,
        },
        sell: {
            minPredictedConfidence: 0.5,
            takeProfitPercentage: 800,
        },
    };
    let strategy: BuySellPredictionStrategy;

    const historyRef: HistoryRef = {
        timestamp: 1740056426861,
        index: 10,
    };
    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';
    const history: HistoryEntry[] = readFixture<{ history: HistoryEntry[] }>(
        'backtest/pumpfun/B6eQdRcdYhuFxXKx75jumoMGkZCE4LCeobSDgZNzpump',
    ).history;

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        strategy = new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, config);
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
                    new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, {
                        prediction: {},
                    } as unknown as BuySellPredictionStrategyConfig),
            ).toThrow(
                new Error(
                    // eslint-disable-next-line quotes
                    "config.prediction.buy: Cannot read properties of undefined (reading 'requiredFeaturesLength')",
                ),
            );

            expect(
                () =>
                    new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, {
                        prediction: {
                            buy: {},
                        },
                    } as unknown as BuySellPredictionStrategyConfig),
            ).toThrow(
                new Error('config.prediction.buy: requiredFeaturesLength is required;skipAllSameFeatures is required'),
            );

            expect(
                () =>
                    new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, {
                        prediction: {
                            ...config.prediction!,
                            sell: {},
                        },
                    } as unknown as BuySellPredictionStrategyConfig),
            ).toThrow(
                new Error('config.prediction.sell: requiredFeaturesLength is required;skipAllSameFeatures is required'),
            );
        });
    });

    defineShouldBuyWithPredictionTests({
        mockServer: mockServer,
        redisMockInstance: redisMockInstance,
        predictionEndpoint: buySourceConfig.endpoint,
        getLogs: () => logs,
        getStrategy: () => strategy,
        formStrategy: ({ buy, prediction }) => {
            let newConfig: Partial<BuySellPredictionStrategyConfig> = {
                ...config,
            };

            if (buy) {
                newConfig.buy = {
                    ...newConfig.buy,
                    ...buy,
                } as BuySellPredictionStrategyConfig['buy'];
            }

            if (prediction) {
                newConfig.prediction!.buy = {
                    ...newConfig.prediction!.buy,
                    ...prediction,
                } as BuySellPredictionStrategyConfig['prediction']['buy'];
            }

            strategy = new BuySellPredictionStrategy(
                logger,
                redisMockInstance,
                buySourceConfig,
                sellSourceConfig,
                newConfig,
            );
        },
        mint: mint,
        historyRef: historyRef,
        history: history,
    });

    describe('shouldSell', () => {
        const mswPredictAboveSellThresholdHandler = http.post(sellSourceConfig.endpoint, async ({ request }) => {
            const body = await request.json();
            if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                return HttpResponse.json({}, { status: 400 });
            }

            return HttpResponse.json(
                {
                    confidence: 0.51,
                },
                { status: 200 },
            );
        });

        beforeEach(() => {
            strategy.afterBuy(3.5e-8, {
                transaction: TradeTransactionFactory(),
                marketContext: NewMarketContextFactory(),
            });
        });

        it('should sell when predicted confidence exceeds threshold for required consecutive confirmations and cache is not used', async () => {
            mockServer.use(mswPredictAboveSellThresholdHandler);
            expect(await strategy.shouldSell(mint, historyRef, history[4], history)).toEqual({
                sell: true,
                reason: 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS',
                data: {
                    predictedSellConfidence: 0.51,
                    consecutivePredictionConfirmations: 1,
                },
            } satisfies ShouldSellResponse);
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({});
        });

        /**
         *  ensure that we don't sell if the returned confidence is below minPredictedConfidence
         *  ensure that we don't sell if confidence is above minPredictedConfidence and haven't reached the specified consecutivePredictionConfirmations
         */
        it('should not sell when predicted confidence increases with the expected threshold but consecutivePredictionConfirmations is less than required consecutive confirmations', async () => {
            strategy = new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, {
                ...config,
                sell: {
                    ...config.sell!,
                    minConsecutivePredictionConfirmations: 2,
                },
            });

            const indexesWithLowerThanThresholdConfidence = [1];
            let callCount = 0;
            mockServer.use(
                http.post(sellSourceConfig.endpoint, async ({ request }) => {
                    const body = await request.json();
                    if (!deepEqual(body, readLocalFixture('prediction-strategy-http-request-1'))) {
                        return HttpResponse.json({}, { status: 400 });
                    }

                    return HttpResponse.json(
                        {
                            confidence: indexesWithLowerThanThresholdConfidence.includes(callCount++) ? 0.49 : 0.53,
                        },
                        { status: 200 },
                    );
                }),
            );

            const sellResponses: ShouldSellResponse[] = [];
            for (let i = 0; i < 4; i++) {
                sellResponses.push(
                    await strategy.shouldSell(
                        mint,
                        {
                            ...historyRef,
                            index: i,
                        },
                        history[4],
                        history,
                    ),
                );
            }
            expect(sellResponses).toEqual([
                {
                    sell: false,
                    reason: 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS',
                    data: {
                        predictedSellConfidence: 0.53,
                        consecutivePredictionConfirmations: 1,
                    },
                },
                {
                    sell: false,
                    data: {
                        predictedSellConfidence: 0.49,
                    },
                    reason: 'minPredictedSellConfidence',
                },
                {
                    sell: false,
                    reason: 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS',
                    data: {
                        predictedSellConfidence: 0.53,
                        consecutivePredictionConfirmations: 1,
                    },
                },
                {
                    sell: true,
                    reason: 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS',
                    data: {
                        predictedSellConfidence: 0.53,
                        consecutivePredictionConfirmations: 2,
                    },
                },
            ]);
        });

        it('should sell if limits are reached without calling the prediction endpoint', async () => {
            const endpointHandler = jest.fn();
            mockServer.use(
                http.post(sellSourceConfig.endpoint, async () => {
                    endpointHandler();
                    throw new Error('should not be called');
                }),
            );

            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...history[4],
                        price: history[4].price * 2,
                    },
                    history,
                ),
            ).toEqual({
                sell: true,
                reason: 'TAKE_PROFIT',
            });
            expect(endpointHandler).not.toHaveBeenCalled();
        });

        it('should log error and return false when it fails to get the predicted confidence', async () => {
            mockServer.use(
                http.post(sellSourceConfig.endpoint, async () => {
                    return HttpResponse.json(
                        {
                            error: 'for fun',
                        },
                        { status: 400 },
                    );
                }),
            );

            expect(await strategy.shouldSell(mint, historyRef, history[4], history)).toEqual({
                sell: false,
                reason: 'prediction_error',
                data: { response: { status: 400, body: { error: 'for fun' } } },
            } satisfies ShouldSellResponse);
            expect(logs.length).toEqual(2);
            expect(logs[0]).toEqual({
                level: 'error',
                message:
                    'Error getting sell prediction for mint 2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx, returning false',
            });
            expect(logs[1].level).toEqual('error');
            expect((logs[1].message as unknown as AxiosResponse).data).toEqual({
                error: 'for fun',
            });
        });

        it('should use the cache correctly', async () => {
            strategy = new BuySellPredictionStrategy(logger, redisMockInstance, buySourceConfig, sellSourceConfig, {
                ...config,
                prediction: {
                    ...config.prediction!,
                    sell: {
                        ...config.prediction!.sell,
                        cache: {
                            enabled: true,
                        },
                    },
                },
                sell: {
                    ...config.sell!,
                    minPredictedConfidence: 0.7,
                },
            });

            let callCount = 0;
            mockServer.use(
                http.post(sellSourceConfig.endpoint, async () => {
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

            expect(await strategy.shouldSell(mint, historyRef, history[4], history)).toEqual({
                sell: false,
                reason: 'minPredictedSellConfidence',
                data: {
                    predictedSellConfidence: 0.2,
                },
            } satisfies ShouldSellResponse);
            expect(callCount).toBe(1);
            expect(
                Object.fromEntries(
                    await Promise.all(
                        (await redisMockInstance.keys('*')).map(async k => [k, await redisMockInstance.get(k)]),
                    ),
                ),
            ).toEqual({
                'sp.c_v2_30p_skf:true_2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx_10:10': '{"confidence":0.2}',
            });

            expect(await strategy.shouldSell(mint, historyRef, history[4], history)).toEqual({
                sell: false,
                reason: 'minPredictedSellConfidence',
                data: {
                    predictedSellConfidence: 0.2,
                },
            } satisfies ShouldSellResponse);
            expect(callCount).toBe(1);
        });

        it('should throw error if the confidence is missing from the response body', async () => {
            mockServer.use(
                http.post(sellSourceConfig.endpoint, async () => {
                    return HttpResponse.json(
                        {
                            lol: true,
                        },
                        { status: 200 },
                    );
                }),
            );

            await expect(strategy.shouldSell(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('The response is missing the required field confidence. {"lol":true}'),
            );
        });

        it('should throw error if the returned confidence is outside the interval [0, 1]', async () => {
            mockServer.use(
                http.post(sellSourceConfig.endpoint, () =>
                    HttpResponse.json(
                        {
                            confidence: -0.1,
                        },
                        { status: 200 },
                    ),
                ),
            );
            await expect(strategy.shouldSell(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got -0.1'),
            );

            mockServer.use(
                http.post(sellSourceConfig.endpoint, () =>
                    HttpResponse.json(
                        {
                            confidence: 1.0001,
                        },
                        { status: 200 },
                    ),
                ),
            );
            await expect(strategy.shouldSell(mint, historyRef, history[4], history)).rejects.toThrow(
                new Error('Expected confidence to be in the interval [0, 1], but got 1.0001'),
            );
        });
    });

    describe('formVariant', () => {
        function getVariant(customConfig: Partial<BuySellPredictionStrategyConfig> = {}) {
            return new BuySellPredictionStrategy(
                logger,
                redisMockInstance,
                buySourceConfig,
                sellSourceConfig,
                customConfig,
            ).config.variant;
        }

        it('should full variant key with all values', () => {
            const key = getVariant({
                prediction: {
                    buy: {
                        skipAllSameFeatures: false,
                        requiredFeaturesLength: 3,
                        upToFeaturesLength: 5,
                    },
                    sell: {
                        skipAllSameFeatures: false,
                        requiredFeaturesLength: 10,
                        upToFeaturesLength: 7,
                    },
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
                    minPredictedConfidence: 0.5,
                    minConsecutivePredictionConfirmations: 7,
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
                't_test_rsi7_bp(skf:false_rql:3_upfl:5)_c_v2_30p_sp(skf:false_rql:10_upfl:7)_buy(mpc:10_mcpc:3_c(hc:l1-h2_mc:l2-h77))_sell(mpc:0.5_mcpc:7_l(tslp:15_slp:33_tpp:10_ttp(pp:30:sp:5)))',
            );
        });

        it('should exclude undefined values and use model defaults', () => {
            const key = getVariant({
                prediction: {
                    buy: {
                        requiredFeaturesLength: 10,
                        upToFeaturesLength: undefined,
                        skipAllSameFeatures: true,
                    },
                    sell: {
                        requiredFeaturesLength: 2,
                        upToFeaturesLength: undefined,
                        skipAllSameFeatures: false,
                    },
                },
                buy: {
                    minPredictedConfidence: 0.5,
                },
                sell: {
                    minPredictedConfidence: 0.25,
                    takeProfitPercentage: 17,
                },
            });
            expect(key).toBe(
                't_test_rsi7_bp(skf:true_rql:10)_c_v2_30p_sp(skf:false_rql:2)_buy(mpc:0.5)_sell(mpc:0.25_l(tpp:17))',
            );
        });
    });
});
