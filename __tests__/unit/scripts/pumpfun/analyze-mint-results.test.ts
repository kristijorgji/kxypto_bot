import fs from 'fs';

import { LogEntry, format } from 'winston';

import { getFiles } from '../../../../src/data/getFiles';
import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { analyzeMintResults } from '../../../../src/scripts/pumpfun/analyze-mint-results';
import { HandlePumpTokenBotReport } from '../../../../src/trading/bots/blockchains/solana/types';
import { formHistoryEntry } from '../../../__utils/blockchains/solana';
import { readLocalFixture } from '../../../__utils/data';
import { mockFsReadFileSync, mockGetFiles } from '../../../__utils/data-mocks';

const realFs = jest.requireActual('fs');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn(),
    mkdirSync: jest.fn(),
}));
const mockedFs = fs as jest.Mocked<typeof fs>;

jest.mock('@src/data/getFiles');
jest.mock('@src/utils/files');

let logs: LogEntry[] = [];

beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2021-03-19T10:00:00Z'));
});

beforeEach(() => {
    logs = [];
    logger.level = 'silly';
    logger.clear().add(new ArrayTransport({ array: logs, json: false, format: format.splat() }));
    jest.resetAllMocks();
});

afterAll(() => {
    jest.useRealTimers();
});

const monitor: HandlePumpTokenBotReport['monitor'] = {
    buyTimeframeMs: 1000,
    sellTimeframeMs: 250,
};

describe('analyzeMintResults', () => {
    describe('PROFIT mode', () => {
        /**
         * skips checking index 0,1 as config requires to start from 2
         * verify that the configs are respected and proper intervals reported
         */
        it('should detect correctly price increases with the provided config', async () => {
            const fileToContent: Record<string, object | string> = {
                'data/a.json': {
                    monitor,
                    history: [
                        // it ignores index 0, 1 due to config and starts from t3
                        formHistoryEntry({ timestamp: 1e3, price: 1 }),
                        formHistoryEntry({ timestamp: 2e3, price: 4 }),
                        // should ignore the increase from t3 to t6 because only 1e3ms is held from t5-t6
                        formHistoryEntry({ timestamp: 3e3, price: 5 }),
                        formHistoryEntry({ timestamp: 4e3, price: 7 }),
                        formHistoryEntry({ timestamp: 5e3, price: 7 }),
                        formHistoryEntry({ timestamp: 6e3, price: 10 }),
                        // should ignore the increase from t7 because t8 price is lower than t7
                        formHistoryEntry({ timestamp: 7e3, price: 2 }),
                        // should report t8-t12
                        formHistoryEntry({ timestamp: 8e3, price: 1 }),
                        formHistoryEntry({ timestamp: 9e3, price: 1 }),
                        formHistoryEntry({ timestamp: 10e3, price: 1.5 }),
                        formHistoryEntry({ timestamp: 11e3, price: 2 }),
                        formHistoryEntry({ timestamp: 12e3, price: 2 }),
                        // should report t13-t17
                        formHistoryEntry({ timestamp: 13e3, price: 0.1 }),
                        formHistoryEntry({ timestamp: 14e3, price: 1 }),
                        formHistoryEntry({ timestamp: 15e3, price: 1.1 }),
                        formHistoryEntry({ timestamp: 16e3, price: 1.2 }),
                        formHistoryEntry({ timestamp: 17e3, price: 1.2 }),
                        // should report t18-t24, the drop in t19 is within the allowed 25% in config
                        formHistoryEntry({ timestamp: 18e3, price: 0.05 }),
                        // should report t19-t24
                        formHistoryEntry({ timestamp: 19e3, price: 0.0377 }),
                        // should report t20-t24
                        formHistoryEntry({ timestamp: 20e3, price: 0.08 }),
                        formHistoryEntry({ timestamp: 21e3, price: 0.09 }),
                        formHistoryEntry({ timestamp: 22e3, price: 0.2 }),
                        formHistoryEntry({ timestamp: 23e3, price: 1.1 }),
                        formHistoryEntry({ timestamp: 24e3, price: 1.2 }),
                        // should not report t25-t26 because t26 price is not more than 25% of t24
                        formHistoryEntry({ timestamp: 25e3, price: 0.01 }),
                        formHistoryEntry({ timestamp: 26e3, price: 0.01 }),
                        formHistoryEntry({ timestamp: 27e3, price: 0.0124 }),
                        formHistoryEntry({ timestamp: 28e3, price: 0.8 }),
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
                'data-2/k.json': {
                    noHistory: 2,
                },
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'PROFIT',
                dataSources: [{ path: 'data' }, { path: 'data-2' }],
                checkPriceAfterMs: 2e3,
                allowedPriceDropInBetweenPercentage: 25,
                requiredPriceChangeDiffPercentage: 25,
                requiredMaintainIncreaseMs: 2e3,
                startFromIndex: 2,
                onlyLogEvents: false,
            });

            expect(actual).toEqual({
                filesWithoutEnoughHistory: [],
                filesWithoutHistory: ['data-2/k.json'],
                processed: 2,
                validFiles: {
                    'data/a.json': {
                        '7': {
                            type: 'WIN',
                            startTimestamp: 8e3,
                            endTimestamp: 12e3,
                            length: 4,
                            timeMs: 4000,
                            maintainedLength: 2,
                            maintainedTimeMs: 2000,
                            startingPriceDiffPercentage: 50,
                            endingPriceDiffPercentage: 100,
                        },
                        '12': {
                            type: 'WIN',
                            startTimestamp: 13e3,
                            endTimestamp: 17e3,
                            length: 4,
                            timeMs: 4000,
                            maintainedLength: 2,
                            maintainedTimeMs: 2000,
                            startingPriceDiffPercentage: 1000,
                            endingPriceDiffPercentage: 1099.9999999999998,
                        },
                        '17': {
                            type: 'WIN',
                            startTimestamp: 18e3,
                            endTimestamp: 24e3,
                            length: 6,
                            timeMs: 6000,
                            maintainedLength: 4,
                            maintainedTimeMs: 4000,
                            startingPriceDiffPercentage: 60,
                            endingPriceDiffPercentage: 2299.9999999999995,
                        },
                        '18': {
                            type: 'WIN',
                            startTimestamp: 19e3,
                            endTimestamp: 24e3,
                            length: 5,
                            timeMs: 5000,
                            maintainedLength: 3,
                            maintainedTimeMs: 3000,
                            startingPriceDiffPercentage: 138.7267904509284,
                            endingPriceDiffPercentage: 3083.0238726790453,
                        },
                        '19': {
                            type: 'WIN',
                            startTimestamp: 20000,
                            endTimestamp: 24000,
                            length: 4,
                            timeMs: 4000,
                            maintainedLength: 2,
                            maintainedTimeMs: 2000,
                            endingPriceDiffPercentage: 1399.9999999999998,
                            startingPriceDiffPercentage: 150,
                        },
                    },
                },
                events: {
                    'data/a.json': {
                        '12000': [{ triggerIndex: 7, leadTimeMs: 4000, data: actual.validFiles['data/a.json']['7'] }],
                        '17000': [{ triggerIndex: 12, leadTimeMs: 4000, data: actual.validFiles['data/a.json']['12'] }],
                        '24000': [
                            { triggerIndex: 17, leadTimeMs: 6000, data: actual.validFiles['data/a.json']['17'] },
                            { triggerIndex: 18, leadTimeMs: 5000, data: actual.validFiles['data/a.json']['18'] },
                            { triggerIndex: 19, leadTimeMs: 4000, data: actual.validFiles['data/a.json']['19'] },
                        ],
                    },
                },
            });

            expect(logs).toEqual(readLocalFixture('analyze-mint-results/expected-logs-1'));
        });

        it('should report a WIN if the file ends while the price is still being maintained', async () => {
            const fileToContent = {
                'data/eof.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 0, price: 100 }),
                        formHistoryEntry({ timestamp: 1000, price: 100 }),
                        formHistoryEntry({ timestamp: 2000, price: 150 }), // t2: Hit Target
                        formHistoryEntry({ timestamp: 3000, price: 150 }),
                        formHistoryEntry({ timestamp: 4000, price: 150 }), // t4: Maintained 2s (Win condition met)
                        formHistoryEntry({ timestamp: 5000, price: 150 }), // t5: End of File
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'PROFIT',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 2000,
                allowedPriceDropInBetweenPercentage: 25,
                requiredPriceChangeDiffPercentage: 25,
                requiredMaintainIncreaseMs: 2000,
                startFromIndex: 0,
                onlyLogEvents: false,
            });

            expect(actual.validFiles['data/eof.json']['0']).toEqual({
                type: 'WIN',
                startTimestamp: 0,
                endTimestamp: 5000, // Should be the last timestamp in file
                length: 5,
                maintainedLength: 3, // t3, t4, t5
                timeMs: 5000,
                maintainedTimeMs: 3000,
                startingPriceDiffPercentage: 50,
                endingPriceDiffPercentage: 50,
            });

            expect(actual.events['data/eof.json']['5000']).toBeDefined();
        });

        it('should handle volatility edge cases (safety floor violations during maintenance and recoveries)', async () => {
            const fileToContent: Record<string, object | string> = {
                'data/volatility.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 0, price: 10 }), // Padding for startFromIndex
                        formHistoryEntry({ timestamp: 1000, price: 10 }),

                        // CASE 1: Safety Floor Violation DURING maintenance
                        // Start Index 2: Price 100. Target +50% (150). Safety -20% (80).
                        formHistoryEntry({ timestamp: 2000, price: 100 }), // t2 (Buy)
                        formHistoryEntry({ timestamp: 3000, price: 100 }), // t3 (Gap)
                        formHistoryEntry({ timestamp: 4000, price: 160 }), // t4 (Meets target + duration start)
                        formHistoryEntry({ timestamp: 5000, price: 70 }), // t5 (CRASH! Below Safety Floor 80)
                        formHistoryEntry({ timestamp: 6000, price: 200 }), // t6 (Recovered, but should be invalidated)

                        // CASE 2: Maintenance Reset / Recovery
                        // Start Index 7: Price 10. Target +50% (15).
                        formHistoryEntry({ timestamp: 7000, price: 10 }), // t7 (Buy)
                        formHistoryEntry({ timestamp: 8000, price: 10 }), // t8 (Gap)
                        formHistoryEntry({ timestamp: 9000, price: 16 }), // t9 (CheckPriceAfterMs starts here)
                        formHistoryEntry({ timestamp: 10000, price: 14.5 }), // t10 (Tiny dip below 15, should reset maintenance)
                        formHistoryEntry({ timestamp: 11000, price: 17 }), // t11
                        formHistoryEntry({ timestamp: 12000, price: 18 }), // t12 (Should only qualify if held for 2s from t11)
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'PROFIT',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 2000, // 2 seconds
                allowedPriceDropInBetweenPercentage: 20, // -20%
                requiredPriceChangeDiffPercentage: 50, // +50%
                requiredMaintainIncreaseMs: 2000, // 2 seconds
                startFromIndex: 2,
                onlyLogEvents: false,
            });

            /**
             * EXPECTATION LOGIC:
             * 1. Index 2 (t2) SHOULD NOT be in validFiles.
             * Even though it hits the target at t4 and t6, the dip at t5 (70) is a 30% drop from 100.
             * Our limit is 20%. The original code would miss this because it stops checking safety at t4.
             * * 2. Index 7 (t7) SHOULD NOT be in validFiles (or should end later).
             * The maintenance starts at t9, but t10 drops below the +50% target.
             * If using your original code, the break at t10 prevents finding a win even if t11-t13 are huge.
             */
            expect(actual.validFiles['data/volatility.json']).toBeUndefined();
            expect(actual.events['data/volatility.json']).toBeUndefined();
        });

        it('should handle a recovery if price dips below target but stays above safety floor', async () => {
            const fileToContent = {
                'data/recovery.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 0, price: 100 }),
                        formHistoryEntry({ timestamp: 1000, price: 100 }),
                        formHistoryEntry({ timestamp: 2000, price: 130 }), // Target Hit
                        formHistoryEntry({ timestamp: 3000, price: 124 }), // Dip (Safe)
                        formHistoryEntry({ timestamp: 4000, price: 130 }),
                        formHistoryEntry({ timestamp: 5000, price: 130 }),
                        formHistoryEntry({ timestamp: 6000, price: 130 }), // Win confirmed here
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'PROFIT',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 2000,
                allowedPriceDropInBetweenPercentage: 25,
                requiredPriceChangeDiffPercentage: 25,
                requiredMaintainIncreaseMs: 2000,
                startFromIndex: 0,
                onlyLogEvents: false,
            });

            expect(actual.validFiles['data/recovery.json']['0']).toBeDefined();
            expect(actual.validFiles['data/recovery.json']['0'].endTimestamp).toBe(6000);
            expect(actual.events['data/recovery.json']['6000']).toBeDefined();
        });

        it('should use actual timestamps instead of index offsets to handle network lag', async () => {
            const fileToContent = {
                'data/lag.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 0, price: 100 }),
                        formHistoryEntry({ timestamp: 5000, price: 150 }), // 5s Gap
                        formHistoryEntry({ timestamp: 6000, price: 150 }),
                        formHistoryEntry({ timestamp: 7000, price: 150 }),
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'PROFIT',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 2000,
                allowedPriceDropInBetweenPercentage: 25,
                requiredPriceChangeDiffPercentage: 25,
                requiredMaintainIncreaseMs: 2000,
                startFromIndex: 0,
                onlyLogEvents: false,
            });

            // At index 1 (timestamp 5000), 5 seconds have passed.
            // 5s > checkPriceAfterMs (2s).
            // If the code uses timestamps, index 0 is a win.
            // If the code uses (checkPriceAfterMs / 1000) = index 2, it will break or look at the wrong spot.
            expect(actual.validFiles['data/lag.json']['0']).toBeDefined();
            expect(actual.events['data/lag.json']['7000']).toBeDefined();
        });
    });

    describe('RUG mode', () => {
        const monitor: HandlePumpTokenBotReport['monitor'] = {
            buyTimeframeMs: 1000,
            sellTimeframeMs: 250,
        };

        it('should correctly detect rug pulls within the time window', async () => {
            const fileToContent: Record<string, object | string> = {
                'data/rugs.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 1e3, price: 100 }), // Index 0
                        formHistoryEntry({ timestamp: 2e3, price: 100 }), // Index 1

                        // Scenario A: Quick Rug
                        // Buy at t3 (100). Rugs at t5 (40). -60% drop.
                        formHistoryEntry({ timestamp: 3e3, price: 100 }), // Index 2 (Buy)
                        formHistoryEntry({ timestamp: 4e3, price: 90 }),
                        formHistoryEntry({ timestamp: 5e3, price: 40 }), // Rug! (2s elapsed)

                        // Scenario B: Slow Bleed (but within window)
                        // Buy at t6 (100). Rugs at t9 (45). -55% drop.
                        formHistoryEntry({ timestamp: 6e3, price: 100 }), // Index 5 (Buy)
                        formHistoryEntry({ timestamp: 7e3, price: 80 }),
                        formHistoryEntry({ timestamp: 8e3, price: 60 }),
                        formHistoryEntry({ timestamp: 9e3, price: 45 }), // Rug! (3s elapsed)

                        // Scenario C: Survived the window (Rug happens too late)
                        // Buy at t10 (100). Window is 3s. Rugs at t15.
                        formHistoryEntry({ timestamp: 10e3, price: 100 }), // Index 9 (Buy)
                        formHistoryEntry({ timestamp: 11e3, price: 90 }),
                        formHistoryEntry({ timestamp: 12e3, price: 90 }),
                        formHistoryEntry({ timestamp: 13e3, price: 90 }), // Window ends here (3s)
                        formHistoryEntry({ timestamp: 15e3, price: 10 }), // Huge rug, but ignored
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'RUG',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 3500, // Look for rugs occurring within 3.5s
                rugThresholdPercentage: 50, // Rug if price drops 50% or more
                startFromIndex: 2,
                onlyLogEvents: false,
            });

            expect(actual).toEqual({
                filesWithoutEnoughHistory: [],
                filesWithoutHistory: [],
                processed: 1,
                validFiles: {
                    'data/rugs.json': {
                        '2': {
                            type: 'RUG',
                            startTimestamp: 3000,
                            endTimestamp: 5000,
                            length: 2,
                            timeMs: 2000,
                            endingPriceDiffPercentage: -60,
                        },
                        '3': {
                            type: 'RUG',
                            startTimestamp: 4000,
                            endTimestamp: 5000,
                            length: 1,
                            timeMs: 1000,
                            endingPriceDiffPercentage: -55.55555555555556,
                        },
                        '5': {
                            type: 'RUG',
                            startTimestamp: 6000,
                            endTimestamp: 9000,
                            length: 3,
                            timeMs: 3000,
                            endingPriceDiffPercentage: -55.00000000000001,
                        },
                        '11': {
                            type: 'RUG',
                            startTimestamp: 12000,
                            endTimestamp: 15000,
                            length: 2,
                            timeMs: 3000,
                            endingPriceDiffPercentage: -88.88888888888889,
                        },
                        '12': {
                            type: 'RUG',
                            startTimestamp: 13000,
                            endTimestamp: 15000,
                            length: 1,
                            timeMs: 2000,
                            endingPriceDiffPercentage: -88.88888888888889,
                        },
                    },
                },
                events: {
                    'data/rugs.json': {
                        '5000': [
                            { triggerIndex: 2, leadTimeMs: 2000, data: actual.validFiles['data/rugs.json']['2'] },
                            { triggerIndex: 3, leadTimeMs: 1000, data: actual.validFiles['data/rugs.json']['3'] },
                        ],
                        '9000': [{ triggerIndex: 5, leadTimeMs: 3000, data: actual.validFiles['data/rugs.json']['5'] }],
                        '15000': [
                            { triggerIndex: 11, leadTimeMs: 3000, data: actual.validFiles['data/rugs.json']['11'] },
                            { triggerIndex: 12, leadTimeMs: 2000, data: actual.validFiles['data/rugs.json']['12'] },
                        ],
                    },
                },
            });
        });

        it('should ignore drops that do not meet the threshold percentage', async () => {
            const fileToContent: Record<string, object | string> = {
                'data/soft-dip.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 1000, price: 100 }),
                        formHistoryEntry({ timestamp: 2000, price: 100 }), // Buy at t2
                        formHistoryEntry({ timestamp: 3000, price: 60 }), // Drop to 60 (-40%)
                        formHistoryEntry({ timestamp: 4000, price: 55 }), // Drop to 55 (-45%)
                        formHistoryEntry({ timestamp: 5000, price: 60 }), // Recovery
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'RUG',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 5000,
                rugThresholdPercentage: 50, // Strict 50% threshold
                startFromIndex: 1,
                onlyLogEvents: false,
            });

            // Even though price dropped 45%, it didn't hit 50%. Should be empty.
            expect(actual.validFiles['data/soft-dip.json']).toBeUndefined();
            expect(actual.events['data/soft-dip.json']).toBeUndefined();
        });

        it('should detect immediate rugs on the very next tick', async () => {
            const fileToContent: Record<string, object | string> = {
                'data/instant-rug.json': {
                    monitor,
                    history: [
                        formHistoryEntry({ timestamp: 0, price: 100 }),
                        formHistoryEntry({ timestamp: 1000, price: 100 }), // Buy
                        formHistoryEntry({ timestamp: 1001, price: 0.001 }), // INSTANT DEATH
                    ],
                } satisfies Partial<HandlePumpTokenBotReport>,
            };

            mockFsReadFileSync(mockedFs, realFs, fileToContent);
            mockGetFiles(getFiles as jest.Mock, fileToContent);

            const actual = await analyzeMintResults({
                mode: 'RUG',
                dataSources: [{ path: 'data' }],
                checkPriceAfterMs: 2000,
                rugThresholdPercentage: 90,
                startFromIndex: 1,
                onlyLogEvents: false,
            });

            expect(actual.validFiles['data/instant-rug.json']['1']).toEqual({
                type: 'RUG',
                startTimestamp: 1000,
                endTimestamp: 1001,
                length: 1,
                timeMs: 1,
                endingPriceDiffPercentage: -99.999,
            });

            expect(actual.events['data/instant-rug.json']['1001']).toBeDefined();
        });
    });
});
