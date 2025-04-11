import { AxiosResponse } from 'axios';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger } from 'winston';

import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import PredictionStrategy from '../../../../../src/trading/strategies/launchpads/PredictionStrategy';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe(PredictionStrategy.name, () => {
    let logs: LogEntry[] = [];
    const logger = createLogger();
    let strategy: PredictionStrategy;

    beforeAll(() => {
        mockServer.listen();
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true }));

        strategy = new PredictionStrategy(
            logger,
            {
                endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
            },
            {
                requiredFeaturesLength: 10,
                buy: {
                    minPredictedPriceIncreasePercentage: 15,
                },
            },
        );
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

    describe('shouldBuy', () => {
        const mswPredictPriceWillIncreaseHandler = http.post(
            process.env.PRICE_PREDICTION_ENDPOINT as string,
            async ({ request }) => {
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
                            1.890614874462375e-7 * (1 + strategy.config.buy.minPredictedPriceIncreasePercentage),
                        ],
                    },
                    { status: 200 },
                );
            },
        );

        it('should buy when the predicted price increases with the expected threshold', async () => {
            mockServer.use(mswPredictPriceWillIncreaseHandler);
            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual(true);
        });

        it('should not buy when the predicted price increases with the expected threshold and context limits do not match', async () => {
            mockServer.use(mswPredictPriceWillIncreaseHandler);
            strategy = new PredictionStrategy(
                logger,
                {
                    endpoint: process.env.PRICE_PREDICTION_ENDPOINT as string,
                },
                {
                    requiredFeaturesLength: 10,
                    buy: {
                        minPredictedPriceIncreasePercentage: 15,
                        context: {
                            holdersCount: {
                                min: 17,
                            },
                        },
                    },
                },
            );
            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual(false);
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
            expect(await strategy.shouldBuy(mint, history[4], history)).toEqual(false);
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

            const actual = await strategy.shouldBuy(mint, history[4], history);
            expect(actual).toEqual(false);
            expect(logs.length).toEqual(2);
            expect(logs[0]).toEqual({
                level: 'error',
                message: 'Error getting price prediction for mint %s, returning false',
            });
            expect(logs[1].level).toEqual('error');
            expect((logs[1].message as unknown as AxiosResponse).data).toEqual({
                error: 'for fun',
            });
        });
    });
});
