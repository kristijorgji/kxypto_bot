import fs from 'fs';

import { LogEntry, format } from 'winston';

import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { AnalyzeMintResultsOutput } from '../../../../src/scripts/pumpfun/analyze-mint-results';
import { ContextValFrequencyMap, buildHeatmap } from '../../../../src/scripts/pumpfun/heatmap';
import { formHistoryEntry } from '../../../__utils/blockchains/solana';
import { mockFsReadFileSync } from '../../../__utils/data-mocks';

const realFs = jest.requireActual('fs');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
}));
const mockedFs = fs as jest.Mocked<typeof fs>;

jest.mock('@src/data/getFiles');
jest.mock('@src/utils/files');

let logs: LogEntry[] = [];

const analyzeMintDummyEntry: AnalyzeMintResultsOutput['validFiles'][string][number] = {
    type: 'WIN',
    startTimestamp: 1754303538833,
    endTimestamp: 1754303635109,
    length: 76,
    timeMs: 96276,
    maintainedLength: 40,
    maintainedTimeMs: 50479,
    startingPriceDiffPercentage: 26.44417874106792,
    endingPriceDiffPercentage: 65.65242688834073,
};

const analyzeMintResults: AnalyzeMintResultsOutput = {
    validFiles: {
        'data/coins/a.json': {
            '1': analyzeMintDummyEntry,
            '2': analyzeMintDummyEntry,
        },
        'data/coins/b.json': {
            '1': analyzeMintDummyEntry,
            '3': analyzeMintDummyEntry,
        },
        'data/coins/c.json': {
            '0': analyzeMintDummyEntry,
        },
    },
    processed: 2,
    filesWithoutHistory: [],
    events: {},
    filesWithoutEnoughHistory: [],
};
const analyzeResultFile = 'analyze-result.json';
const fileToContent: Record<string, object | string> = {
    [analyzeResultFile]: analyzeMintResults,
    'data/coins/a.json': {
        history: [
            formHistoryEntry(),
            formHistoryEntry({
                // @ts-ignore
                price: null,
                marketCap: 0,
            }),
            formHistoryEntry({
                price: 12,
            }),
        ],
    },
    'data/coins/b.json': {
        history: [
            formHistoryEntry(),
            formHistoryEntry({
                price: 27,
                marketCap: 7,
            }),
            formHistoryEntry(),
            formHistoryEntry({
                price: 1,
                topHolderCirculatingPercentage: null,
            }),
        ],
    },
    'data/coins/c.json': {
        history: [
            formHistoryEntry({
                // @ts-ignore
                price: null,
                topHolderCirculatingPercentage: null,
                // @ts-ignore
                bondingCurveProgress: null,
            }),
        ],
    },
};

beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2021-03-19T10:00:00Z'));
});

beforeEach(() => {
    logs = [];
    logger.level = 'silly';
    logger.clear().add(new ArrayTransport({ array: logs, json: false, format: format.splat() }));
    jest.resetAllMocks();

    mockFsReadFileSync(mockedFs, realFs, fileToContent);
});

afterAll(() => {
    jest.useRealTimers();
});

const commonExpectedResult: Partial<ContextValFrequencyMap> = {
    index: {
        '0': 1,
        '1': 2,
        '2': 1,
        '3': 1,
    },
    timeFromStartS: {
        '1754303538': 5,
    },
    bondingCurveProgress: {
        '25': 5,
    },
    devHoldingPercentage: {
        '10': 5,
    },
    devHoldingPercentageCirculating: {
        '20': 5,
    },
    holdersCount: {
        '15': 5,
    },
    topTenHoldingPercentage: {
        '35': 5,
    },
    topTenHoldingPercentageCirculating: {
        '70': 5,
    },
};

describe('heatmap', () => {
    it('should respect nulls and zeros as specified in config', async () => {
        await expect(
            buildHeatmap({
                analyzeResultPath: analyzeResultFile,
                reportPath: 'heatmap.json',
                ignoreNulls: false,
                makeNullsZero: false,
                ignoreZeros: false,
            }),
        ).resolves.toEqual({
            ...commonExpectedResult,
            price: {
                '1': 1,
                '12': 1,
                '27': 1,
                null: 2,
            },
            marketCap: {
                '0': 1,
                '7': 1,
                '31.770000079': 3,
            },
            topHolderCirculatingPercentage: {
                '12': 3,
                null: 2,
            },
        });
    });

    it('should make nulls zero if config says so', async () => {
        await expect(
            buildHeatmap({
                analyzeResultPath: analyzeResultFile,
                reportPath: 'heatmap.json',
                ignoreNulls: false,
                makeNullsZero: true,
                ignoreZeros: false,
            }),
        ).resolves.toEqual({
            ...commonExpectedResult,
            price: {
                '0': 2,
                '1': 1,
                '12': 1,
                '27': 1,
            },
            marketCap: {
                '0': 1,
                '7': 1,
                '31.770000079': 3,
            },
            topHolderCirculatingPercentage: {
                '0': 2,
                '12': 3,
            },
        });
    });

    it('should ignore nulls and zeros if config says so', async () => {
        await expect(
            buildHeatmap({
                analyzeResultPath: analyzeResultFile,
                reportPath: 'heatmap.json',
                ignoreNulls: true,
                makeNullsZero: false,
                ignoreZeros: true,
            }),
        ).resolves.toEqual({
            ...commonExpectedResult,
            price: {
                '1': 1,
                '12': 1,
                '27': 1,
            },
            marketCap: {
                '7': 1,
                '31.770000079': 3,
            },
            topHolderCirculatingPercentage: {
                '12': 3,
            },
        });
    });
});
