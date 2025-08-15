import { AxiosResponse } from 'axios';
import Redis from 'ioredis';
import { HttpResponse, http } from 'msw';
import { SetupServerApi } from 'msw/node';
import { LogEntry } from 'winston';

import { HistoryRef } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { ShouldBuyResponse } from '../../../../../src/trading/bots/types';
import { BuyPredictionStrategyConfig } from '../../../../../src/trading/strategies/launchpads/BuyPredictionStrategy';
import LaunchpadBotStrategy from '../../../../../src/trading/strategies/launchpads/LaunchpadBotStrategy';
import { StrategyPredictionConfig } from '../../../../../src/trading/strategies/types';
import { deepEqual } from '../../../../../src/utils/data/equals';
import { readLocalFixture } from '../../../../__utils/data';

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
        prediction?: Partial<StrategyPredictionConfig>;
        buy?: Partial<BuyPredictionStrategyConfig['buy']>;
    }) => void;
    mint: string;
    historyRef: HistoryRef;
    history: HistoryEntry[];
}) {
    describe('shouldBuy', () => {
        const mswPredictAboveThresholdBuyHandler = http.post(predictionEndpoint, async ({ request }) => {
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
            mockServer.use(
                http.post(predictionEndpoint, async ({ request }) => {
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

            expect(await getStrategy().shouldBuy(mint, historyRef, history[4], history)).toEqual({
                buy: false,
                reason: 'minPredictedBuyConfidence',
                data: {
                    predictedBuyConfidence: 0.49,
                },
            } satisfies ShouldBuyResponse);
        });

        it('should log error and return false when it fails to get the predicted confidence', async () => {
            mockServer.use(
                http.post(predictionEndpoint, async () => {
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
    });
}
