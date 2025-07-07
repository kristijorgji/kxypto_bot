import fs from 'fs';
import { basename } from 'path';

import { LogEntry, format } from 'winston';

import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { validateBacktestFilesProgram } from '../../../../src/scripts/pumpfun/validate-backtest-files';
import { getBacktestFiles } from '../../../../src/trading/backtesting/utils';
import { FileInfo, moveFile } from '../../../../src/utils/files';
import { formHistoryEntry } from '../../../__utils/blockchains/solana';
import { readLocalFixture } from '../../../__utils/data';

const realFs = jest.requireActual('fs');
jest.mock('fs', () => {
    return {
        ...jest.requireActual('fs'),
        readFileSync: jest.fn(),
        mkdirSync: jest.fn(),
    };
});
const mockedFs = fs as jest.Mocked<typeof fs>;

jest.mock('../../../../src/trading/backtesting/utils');

jest.mock('@src/utils/files');

let logs: LogEntry[] = [];

beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2021-03-19T10:00:00Z'));
});

beforeEach(() => {
    logs = [];
    logger.clear().add(new ArrayTransport({ array: logs, json: false, format: format.splat() }));
});

afterAll(() => {
    jest.useRealTimers();
});

it('should mark files containing nulls as invalid', async () => {
    const fileToContent: Record<string, object | string> = {
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
    mockFsReadFileSync(fileToContent);
    (getBacktestFiles as jest.Mock).mockReturnValue(
        Object.keys(fileToContent).map(fullPath => ({
            name: basename(fullPath),
            fullPath: fullPath,
            creationTime: new Date(),
        })) satisfies FileInfo[],
    );

    await runCommand(['--path', './data', '--includeIfPathContains', 'foo,bar', '--extractTo', './data/invalid']);

    expect(logs).toEqual(readLocalFixture('validate-backtest-files/expected-logs-1.txt'));
    expect((moveFile as jest.Mock).mock.calls).toEqual([
        ['data/a.json', './data/invalid/nulls/a.json'],
        ['data/no-history.json', './data/invalid/without_history/no-history.json'],
        ['data/bla.txt', './data/invalid/not_json/bla.txt'],
    ]);
});

async function runCommand(args: string[]): Promise<void> {
    process.argv = ['node', 'command', ...args];
    await validateBacktestFilesProgram.parseAsync(process.argv);
}

function mockFsReadFileSync(map: Record<string, object | string>) {
    (mockedFs.readFileSync as jest.Mock).mockImplementation((...args) => {
        const [path] = args;
        const value = map[path];

        if (value) {
            return typeof value === 'object' ? JSON.stringify(value) : value;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return realFs.readFileSync(...(args as [any, any]));
    });
}
