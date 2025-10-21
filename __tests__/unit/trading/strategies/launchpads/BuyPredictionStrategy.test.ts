import redisMock from 'ioredis-mock';
import { setupServer } from 'msw/node';
import { LogEntry, createLogger, format } from 'winston';

import { buyEnsemblePredictionSource } from './data';
import { defineShouldBuyWithPredictionTests } from './shouldBuyTestCases';
import ArrayTransport from '../../../../../src/logger/transports/ArrayTransport';
import { HistoryEntry } from '../../../../../src/trading/bots/launchpads/types';
import { HistoryRef } from '../../../../../src/trading/bots/types';
import BuyPredictionStrategy, {
    BuyPredictionStrategyConfig,
} from '../../../../../src/trading/strategies/launchpads/BuyPredictionStrategy';
import { PredictionSource, StrategyPredictionConfig } from '../../../../../src/trading/strategies/types';
import { readFixture } from '../../../../__utils/data';

const mockServer = setupServer();

describe('BuyPredictionStrategy', () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const redisMockInstance = new redisMock();
    const sourceConfig: PredictionSource = {
        algorithm: 'transformers',
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

    defineShouldBuyWithPredictionTests({
        mockServer: mockServer,
        redisMockInstance: redisMockInstance,
        predictionEndpoint: sourceConfig.endpoint,
        getLogs: () => logs,
        getStrategy: () => strategy,
        formStrategy: ({ source, prediction, buy }) => {
            let newConfig: Partial<BuyPredictionStrategyConfig> = {
                ...config,
            };

            if (buy) {
                newConfig.buy = {
                    ...newConfig.buy,
                    ...buy,
                } as BuyPredictionStrategyConfig['buy'];
            }

            if (prediction) {
                newConfig.prediction = {
                    ...newConfig.prediction,
                    ...prediction,
                } as BuyPredictionStrategyConfig['prediction'];
            }

            strategy = new BuyPredictionStrategy(logger, redisMockInstance, source ?? sourceConfig, newConfig);
        },
        mint: mint,
        historyRef: historyRef,
        history: history,
    });

    describe('formVariant', () => {
        function getVariant(customConfig: Partial<BuyPredictionStrategyConfig> = {}, source?: PredictionSource) {
            return new BuyPredictionStrategy(logger, redisMockInstance, source ?? sourceConfig, customConfig).config
                .variant;
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
                    downsideProtection: {
                        source: {
                            algorithm: 'catboost',
                            model: 'v2_50_drop',
                            endpoint: 'http://localhost:8545/downside/predict',
                        },
                        prediction: {
                            skipAllSameFeatures: true,
                            requiredFeaturesLength: 10,
                            upToFeaturesLength: 700,
                        },
                        minPredictedConfidence: 0.5,
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
                't_test_rsi7_p(skf:false_rql:3_upfl:5)_buy(mpc:10_mcpc:3_c(hc:l1-h2_mc:l2-h77)_downsideProtection(c_v2_50_drop_p(skf:true_rql:10_upfl:700)_mpc:0.5))_sell(tpp:10_tslp:15_slp:33_ttp(pp:30:sp:5))',
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
            expect(key).toBe('t_test_rsi7_p(skf:true_rql:10)_buy(mpc:0.5)_sell(tpp:17)');
        });

        it('should form proper variant when using ensemble prediction source', () => {
            const key = getVariant({}, buyEnsemblePredictionSource);
            expect(key).toBe(
                'e_ag:weighted_[(c_v100:w0.77)+(t_supra_transformers_v7:w0.23)]_p(skf:true_rql:10)_buy(mpc:0.5)_sell(tslp:15_tpp:15)',
            );
        });
    });

    describe('formBaseCacheKey', () => {
        const sourceConfig: PredictionSource = {
            endpoint: process.env.BUY_PREDICTION_ENDPOINT as string,
            algorithm: 'transformers',
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

        function getKeyFromConfig(customConfig: Partial<BuyPredictionStrategyConfig> = {}, source?: PredictionSource) {
            let strategy: BuyPredictionStrategy;
            strategy = new BuyPredictionStrategy(logger, redisMockInstance, source ?? sourceConfig, {
                ...defaultConfig,
                ...customConfig,
            });

            return (strategy as unknown as { cacheBaseKey: string }).cacheBaseKey;
        }

        it('should generate full cache key with all values', () => {
            const key = getKeyFromConfig();
            expect(key).toBe('bp.t_m1_skf:false');
        });

        it('should handle boolean true correctly', () => {
            const key = getKeyFromConfig({
                prediction: { requiredFeaturesLength: 3, upToFeaturesLength: 5, skipAllSameFeatures: true },
            });
            expect(key).toContain('_skf:true');
            expect(key).toBe('bp.t_m1_skf:true');
        });

        it('should handle boolean false correctly', () => {
            const key = getKeyFromConfig({
                prediction: { requiredFeaturesLength: 3, upToFeaturesLength: 5, skipAllSameFeatures: false },
            });
            expect(key).toContain('_skf:false');
            expect(key).toBe('bp.t_m1_skf:false');
        });

        it('should generate multiple cache keys when using client-side ensemble mode', () => {
            expect(getKeyFromConfig({}, buyEnsemblePredictionSource)).toEqual([
                'bp.c_v100_skf:false',
                'bp.t_supra_transformers_v7_skf:false',
            ]);
        });
    });
});
