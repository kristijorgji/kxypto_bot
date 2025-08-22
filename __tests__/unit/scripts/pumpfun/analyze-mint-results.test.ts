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
jest.mock('fs', () => {
    return {
        ...jest.requireActual('fs'),
        readFileSync: jest.fn(),
        mkdirSync: jest.fn(),
    };
});
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
                    formHistoryEntry({
                        timestamp: 1,
                        price: 1,
                    }),
                    formHistoryEntry({
                        timestamp: 2,
                        price: 4,
                    }),
                    // should report interval starting at t3 ending t6
                    formHistoryEntry({
                        timestamp: 3,
                        price: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 4,
                        price: 7,
                    }),
                    formHistoryEntry({
                        timestamp: 5,
                        price: 7,
                    }),
                    formHistoryEntry({
                        timestamp: 6,
                        price: 10,
                    }),
                    // should ignore the increase from t7 because t8 price is lower than t7
                    formHistoryEntry({
                        timestamp: 7,
                        price: 2,
                    }),
                    // should report t8-t11
                    formHistoryEntry({
                        timestamp: 8,
                        price: 1,
                    }),
                    formHistoryEntry({
                        timestamp: 9,
                        price: 1,
                    }),
                    formHistoryEntry({
                        timestamp: 10,
                        price: 1.5,
                    }),
                    formHistoryEntry({
                        timestamp: 11,
                        price: 2,
                    }),
                    // should report t12-t15
                    formHistoryEntry({
                        timestamp: 12,
                        price: 0.1,
                    }),
                    formHistoryEntry({
                        timestamp: 13,
                        price: 1,
                    }),
                    formHistoryEntry({
                        timestamp: 14,
                        price: 1.1,
                    }),
                    formHistoryEntry({
                        timestamp: 15,
                        price: 1.2,
                    }),
                    // should report t16-t21, the drop in t17 is within the allowed 25% in config
                    formHistoryEntry({
                        timestamp: 16,
                        price: 0.05,
                    }),
                    // should report t17-t21
                    formHistoryEntry({
                        timestamp: 17,
                        price: 0.0377,
                    }),
                    // should report t18-t21
                    formHistoryEntry({
                        timestamp: 18,
                        price: 0.08,
                    }),
                    formHistoryEntry({
                        timestamp: 19,
                        price: 0.09,
                    }),
                    formHistoryEntry({
                        timestamp: 20,
                        price: 0.2,
                    }),
                    formHistoryEntry({
                        timestamp: 21,
                        price: 1.2,
                    }),
                    // should not report t22-t24 because t24 price is not more than 25% of t22
                    formHistoryEntry({
                        timestamp: 22,
                        price: 0.01,
                    }),
                    formHistoryEntry({
                        timestamp: 23,
                        price: 0.01,
                    }),
                    formHistoryEntry({
                        timestamp: 24,
                        price: 0.0124,
                    }),
                    formHistoryEntry({
                        timestamp: 25,
                        price: 0.8,
                    }),
                ],
            } satisfies Partial<HandlePumpTokenBotReport>,
        };

        mockFsReadFileSync(mockedFs, realFs, fileToContent);
        mockGetFiles(getFiles as jest.Mock, fileToContent);

        const actual = await analyzeMintResults({
            dataSource: {
                path: './data',
            },
            checkPriceAfterMs: 2e3,
            allowedPriceDropInBetweenPercentage: 25,
            requiredPriceChangeDiffPercentage: 25,
            requiredMaintainIncreaseMs: 2e3,
            startFromIndex: 2,
            logOnlyProfitable: false,
        });

        expect(actual).toEqual({
            filesWithoutEnoughHistory: [],
            filesWithoutHistory: [],
            processed: 1,
            validFiles: {
                'data/a.json': {
                    '2': {
                        length: 2,
                        startingPriceDiffPercentage: 40,
                        endingPriceDiffPercentage: 100,
                        startTimestamp: 3,
                        endTimestamp: 6,
                        timeMs: 2000,
                    },
                    '7': {
                        length: 2,
                        startingPriceDiffPercentage: 50,
                        endingPriceDiffPercentage: 100,
                        startTimestamp: 8,
                        endTimestamp: 11,
                        timeMs: 2000,
                    },
                    '11': {
                        length: 2,
                        startingPriceDiffPercentage: 1000,
                        endingPriceDiffPercentage: 1099.9999999999998,
                        startTimestamp: 12,
                        endTimestamp: 15,
                        timeMs: 2000,
                    },
                    '15': {
                        length: 4,
                        startingPriceDiffPercentage: 60,
                        endingPriceDiffPercentage: 2299.9999999999995,
                        startTimestamp: 16,
                        endTimestamp: 21,
                        timeMs: 4000,
                    },
                    '16': {
                        length: 3,
                        startingPriceDiffPercentage: 138.7267904509284,
                        endingPriceDiffPercentage: 3083.0238726790453,
                        startTimestamp: 17,
                        endTimestamp: 21,
                        timeMs: 3000,
                    },
                    '17': {
                        length: 2,
                        startingPriceDiffPercentage: 150,
                        endingPriceDiffPercentage: 1399.9999999999998,
                        startTimestamp: 18,
                        endTimestamp: 21,
                        timeMs: 2000,
                    },
                },
            },
        });

        expect(logs).toEqual(readLocalFixture('analyze-mint-results/expected-logs-1.txt'));
    });
});
