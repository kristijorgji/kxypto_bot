import fs from 'fs';

import { LogEntry, format } from 'winston';

import { getFiles } from '@src/data/getFiles';

import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import {
    ValidateBacktestFilesConfig,
    validateBacktestFiles,
    validateBacktestFilesProgram,
} from '../../../../src/scripts/pumpfun/validate-backtest-files';
import { moveFile } from '../../../../src/utils/files';
import { formHistoryEntry } from '../../../__utils/blockchains/solana';
import { runCommandAsync } from '../../../__utils/commander';
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

const config: ValidateBacktestFilesConfig = {
    dataSource: {
        path: './data',
        includeIfPathContains: ['foo', 'bar'],
    },
    rules: {
        notJson: true,
        nulls: {
            enabled: true,
            exclude: {
                devHoldingPercentageCirculating: {
                    upToIndex: 12,
                },
                topTenHoldingPercentageCirculating: {
                    upToIndex: 12,
                },
                topHolderCirculatingPercentage: {
                    upToIndex: 12,
                },
            },
        },
        noHistory: true,
    },
    extractTo: './data/invalid',
};

const fileToContent: Record<string, object | string> = {
    'config.json': config,
    'data/a.json': {
        history: [
            formHistoryEntry({
                timestamp: 1,
            }),
            {
                ...formHistoryEntry({
                    timestamp: 2,
                }),
                price: null,
            },
            {
                ...formHistoryEntry({
                    timestamp: 3,
                }),
                price: null,
            },
            {
                ...formHistoryEntry({
                    timestamp: 4,
                }),
                holdersCount: null,
            },
            {
                ...formHistoryEntry({
                    timestamp: 5,
                }),
                price: null,
            },
            {
                ...formHistoryEntry({
                    timestamp: 6,
                }),
                topTenHoldingPercentage: null,
            },
            {
                ...formHistoryEntry({
                    timestamp: 7,
                }),
                devHoldingPercentageCirculating: null,
                topTenHoldingPercentageCirculating: null,
                topHolderCirculatingPercentage: null,
            },
            ...Array(5)
                .fill(0)
                .map((_, index) => formHistoryEntry({ timestamp: 7 + index + 1 })),
            // matches upToIndex and should be excluded
            {
                ...formHistoryEntry({
                    timestamp: 13,
                }),
                devHoldingPercentageCirculating: null,
                topTenHoldingPercentageCirculating: null,
                topHolderCirculatingPercentage: null,
            },
            // should detect this null after upToIndex
            {
                ...formHistoryEntry({
                    timestamp: 14,
                }),
                devHoldingPercentageCirculating: null,
                topTenHoldingPercentageCirculating: null,
                topHolderCirculatingPercentage: null,
            },
        ],
    },
    'data/ok.json': {
        history: [formHistoryEntry()],
    },
    'data/no-history.json': {
        exit: 'sure',
    },
    'data/bla.txt': 'very secret file',
};

describe('validateBacktestFilesProgram', () => {
    it('should mark files containing nulls as invalid using file config', async () => {
        mockFsReadFileSync(mockedFs, realFs, fileToContent);
        mockGetFiles(getFiles as jest.Mock, fileToContent);

        await runCommandAsync(validateBacktestFilesProgram, ['--config', 'config.json']);

        expect(logs).toEqual(readLocalFixture('validate-backtest-files/expected-logs-1.txt'));
        expect((moveFile as jest.Mock).mock.calls).toEqual([
            ['data/a.json', './data/invalid/nulls/a.json'],
            ['data/no-history.json', './data/invalid/without_history/no-history.json'],
            ['data/bla.txt', './data/invalid/not_json/bla.txt'],
        ]);
    });
});

describe('validateBacktestFiles', () => {
    it('should return all information in an object once done', async () => {
        mockFsReadFileSync(mockedFs, realFs, fileToContent);
        mockGetFiles(getFiles as jest.Mock, fileToContent);

        const r = await validateBacktestFiles(config);
        expect(r).toEqual(readLocalFixture('validate-backtest-files/exp-result-1'));
    });
});
