import { LogEntry, createLogger, format } from 'winston';

import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { HistoryRef } from '../../../../../src/trading/bots/types';
import { formBaseCacheKey, shouldBuyCommon } from '../../../../../src/trading/strategies/launchpads/prediction-common';
import { PredictionSource, StrategyPredictionConfig } from '../../../../../src/trading/strategies/types';
import { readFixture, readLocalFixture } from '../../../../__utils/data';

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
        } satisfies StrategyPredictionConfig,
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
        expect(formBaseCacheKey('buy', {} as StrategyPredictionConfig, commonSource)).toBe('bp.t_transformers_v1');
    });

    it('should generate a correct cache key for "sell" type without skipAllSameFeatures', () => {
        expect(formBaseCacheKey('sell', {} as StrategyPredictionConfig, commonSource)).toBe('sp.t_transformers_v1');
    });

    it('should generate a correct cache key for "price" type without skipAllSameFeatures', () => {
        expect(formBaseCacheKey('price', {} as StrategyPredictionConfig, commonSource)).toBe('pp.t_transformers_v1');
    });

    it('should include "skf:true" when skipAllSameFeatures is true', () => {
        expect(formBaseCacheKey('buy', { skipAllSameFeatures: true } as StrategyPredictionConfig, commonSource)).toBe(
            'bp.t_transformers_v1_skf:true',
        );
    });

    it('should include "skf:false" when skipAllSameFeatures is false', () => {
        expect(formBaseCacheKey('buy', { skipAllSameFeatures: false } as StrategyPredictionConfig, commonSource)).toBe(
            'bp.t_transformers_v1_skf:false',
        );
    });

    it('should use the correct model name from source', () => {
        const customSource: PredictionSource = { ...commonSource, model: 'catboost_v2' };
        expect(formBaseCacheKey('buy', {} as StrategyPredictionConfig, customSource)).toBe('bp.t_catboost_v2');
    });

    it('should use the correct model name and algorithm and include skf when both are present', () => {
        const customSource: PredictionSource = { ...commonSource, algorithm: 'original', model: 'neural_net_prod' };
        expect(formBaseCacheKey('sell', { skipAllSameFeatures: true } as StrategyPredictionConfig, customSource)).toBe(
            'sp.o_neural_net_prod_skf:true',
        );
    });

    it('should not add underscore if pc is empty (skipAllSameFeatures undefined)', () => {
        expect(formBaseCacheKey('price', {} as StrategyPredictionConfig, commonSource)).toBe('pp.t_transformers_v1');
    });

    it('should not add underscore if pc is empty (skipAllSameFeatures is null)', () => {
        expect(
            formBaseCacheKey(
                'buy',
                {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    skipAllSameFeatures: null as any,
                } as StrategyPredictionConfig,
                commonSource,
            ),
        ).toBe('bp.t_transformers_v1_skf:null');
    });
});
