import { AxiosResponse } from 'axios';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import PredictionStrategy, {
    PredictPricesRequest,
} from '../../../../../src/trading/strategies/launchpads/PredictionStrategy';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe(PredictionStrategy.name, () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const sourceConfig = {
        endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
    };
    const config = {
        requiredFeaturesLength: 10,
        buy: {
            minPredictedPriceIncreasePercentage: 15,
        },
    };
    let strategy: PredictionStrategy;

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        strategy = new PredictionStrategy(logger, sourceConfig, config);
    });

    afterEach(() => {
        mockServer.resetHandlers();
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
            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
                buy: true,
                reason: 'consecutivePredictionConfirmations',
                data: {
                    lastNextPrice: 2.1931132543763547e-7,
                    lastNextVariance: null,
                },
            });
        });

        it('should not buy when predicted price increases with the expected threshold but consecutivePredictionConfirmations is less than required consecutive confirmations', async () => {
            strategy = new PredictionStrategy(logger, sourceConfig, {
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
                expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
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
                expect(await strategy.shouldBuy(mint, history[4], [history[4]])).toEqual({
                    buy: false,
                    reason: 'requiredFeaturesLength',
                });
            });

            it('should send upToFeaturesLength features when it is less than history length', async () => {
                strategy = new PredictionStrategy(logger, sourceConfig, { ...config, upToFeaturesLength: 380 });
                mockServer.use(
                    http.post(process.env.PRICE_PREDICTION_ENDPOINT as string, async ({ request }) => {
                        const body = (await request.json()) as PredictPricesRequest;
                        if (body.features.length !== 380) {
                            return HttpResponse.json({}, { status: 400 });
                        }

                        return HttpResponse.json(dummyApiSuccessResponse, { status: 200 });
                    }),
                );

                expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
                    buy: true,
                    reason: 'consecutivePredictionConfirmations',
                    data: {
                        lastNextPrice: 2.1931132543763547e-7,
                        lastNextVariance: null,
                    },
                });
            });

            it('should send all available features when history is shorter than upToFeaturesLength', async () => {
                strategy = new PredictionStrategy(logger, sourceConfig, {
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

                expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
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
                expect(await strategy.shouldBuy(mint, historyWithoutVariation[33], historyWithoutVariation)).toEqual({
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
                strategy = new PredictionStrategy(logger, sourceConfig, {
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

                expect(await strategy.shouldBuy(mint, historyWithoutVariation[33], historyWithoutVariation)).toEqual({
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
            strategy = new PredictionStrategy(logger, sourceConfig, {
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

            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
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

            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
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

            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual({
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
    });
});
