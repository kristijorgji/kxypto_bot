import fs from 'fs';
import { basename } from 'path';

import { LogEntry, createLogger, format } from 'winston';

import Pumpfun from '../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../src/blockchains/solana/dex/pumpfun/types';
import { forceGetPumpCoinInitialData } from '../../../../src/blockchains/solana/dex/pumpfun/utils';
import { solToLamports } from '../../../../src/blockchains/utils/amount';
import { pumpfunRepository } from '../../../../src/db/repositories/PumpfunRepository';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { createInitialStrategyResultLiveState, runStrategy } from '../../../../src/trading/backtesting/runStrategy';
import PumpfunBacktester from '../../../../src/trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestStrategyRunConfig } from '../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../src/trading/bots/launchpads/types';
import RiseStrategy from '../../../../src/trading/strategies/launchpads/RiseStrategy';
import StupidSniperStrategy from '../../../../src/trading/strategies/launchpads/StupidSniperStrategy';
import { formHistoryEntry } from '../../../__utils/blockchains/solana';
import { readFixture, readLocalFixture } from '../../../__utils/data';
import { FullTestExpectation } from '../../../__utils/types';

jest.mock('../../../../src/blockchains/solana/dex/pumpfun/utils', () => ({
    ...jest.requireActual('../../../../src/blockchains/solana/dex/pumpfun/utils'),
    forceGetPumpCoinInitialData: jest.fn(),
}));

const realFs = jest.requireActual('fs');
jest.mock('fs', () => {
    return {
        ...jest.requireActual('fs'),
        readFileSync: jest.fn(),
    };
});
const mockedFs = fs as jest.Mocked<typeof fs>;

jest.mock('uuid', () => ({
    v4: () => Date.now(),
}));

describe('runStrategy', () => {
    let logs: LogEntry[] = [];
    const logger = createLogger();
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const pumpfunBacktester = new PumpfunBacktester(logger);
    const runStrategyDeps = {
        backtester: pumpfunBacktester,
        pumpfun: pumpfun,
        logger: logger,
    };
    const runConfig: BacktestStrategyRunConfig = {
        initialBalanceLamports: solToLamports(1),
        strategy: new StupidSniperStrategy(logger, {
            sell: {
                takeProfitPercentage: 10,
            },
        }),
        buyAmountSol: 0.5,
        jitoConfig: {
            jitoEnabled: true,
        },
        randomization: {
            priorityFees: false,
            slippages: 'off',
            execution: false,
        },
        onlyOneFullTrade: true,
        sellUnclosedPositionsAtEnd: false,
    };

    let paused = false;
    let aborted = false;

    let runStrategyState = {
        pausedRef: () => paused,
        abortedRef: () => aborted,
        ls: createInitialStrategyResultLiveState(),
    };

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2021-03-19T10:00:00Z'));
    });

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        (forceGetPumpCoinInitialData as jest.Mock).mockImplementation((...args) => {
            return Promise.resolve({
                ...readFixture<PumpfunInitialCoinData>('dex/pumpfun/get-coin-data'),
                mint: args[2],
            });
        });

        runStrategyState.ls = createInitialStrategyResultLiveState();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    const histories: Record<string, HistoryEntry[]> = {
        a: [
            // it will buy here as we set all conditions to match the strategy buy config
            formHistoryEntry({
                timestamp: 1,
                price: 1,
            }),
            // it will sell here
            formHistoryEntry({
                timestamp: 2,
                price: 2,
            }),
        ],
        b: [
            // it will buy here as we set all conditions to match the strategy buy config
            formHistoryEntry({
                timestamp: 1,
                price: 2.2,
            }),
            // it will sell here at loss because new price after slippage is lower than buy price
            formHistoryEntry({
                timestamp: 2,
                price: 2.421,
            }),
        ],
    };

    it('1 - should work as expected when there are no holdings left with verbose logging', async () => {
        mockFsReadFileSync(histories);

        const actual = await runStrategy(
            runStrategyDeps,
            runStrategyState,
            runConfig,
            Object.keys(histories).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
            {
                logging: {
                    level: 'verbose',
                    includeTrades: true,
                },
            },
        );

        const expectedData = readLocalFixture<FullTestExpectation>('utils/1.json');

        expect(actual).toEqual(expectedData.result);

        const mockedFsReadFileSync = mockedFs.readFileSync as jest.Mock;
        expect(mockedFsReadFileSync.mock.calls[0]).toEqual(['tmp_test/a.json']);
        expect(mockedFsReadFileSync.mock.calls[2]).toEqual(['tmp_test/b.json']);
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'a');
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'b');
        expect(logs).toEqual(expectedData.logs);
    });

    it('2 - should work as expected when there are holdings left', async () => {
        mockFsReadFileSync(histories);

        const actual = await runStrategy(
            runStrategyDeps,
            runStrategyState,
            {
                ...runConfig,
                strategy: new StupidSniperStrategy(logger, {
                    sell: {
                        takeProfitPercentage: 100,
                    },
                }),
            },
            Object.keys(histories).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
        );

        expect(actual).toEqual(readLocalFixture<FullTestExpectation>('utils/2.json').result);
    });

    const historiesThatResultInLoss: Record<string, HistoryEntry[]> = {
        la: [
            // it will buy here as we set all conditions to match the strategy buy config
            formHistoryEntry({
                timestamp: 1,
                price: 10,
            }),
            // it will sell here
            formHistoryEntry({
                timestamp: 2,
                price: 7.3,
            }),
        ],
        lb: [
            // it will buy here as we set all conditions to match the strategy buy config
            formHistoryEntry({
                timestamp: 1,
                price: 8,
            }),
            // it will sell here
            formHistoryEntry({
                timestamp: 2,
                price: 0.1,
            }),
        ],
        lc: [
            // it will buy here as we set all conditions to match the strategy buy config
            formHistoryEntry({
                timestamp: 1,
                price: 12,
            }),
            // it will sell here
            formHistoryEntry({
                timestamp: 2,
                price: 2,
            }),
        ],
    };

    it('3 - should stop checking next mints if we have no balance left', async () => {
        mockFsReadFileSync(historiesThatResultInLoss);

        const actual = await runStrategy(
            runStrategyDeps,
            runStrategyState,
            {
                ...runConfig,
                strategy: new StupidSniperStrategy(logger, {
                    sell: {
                        takeProfitPercentage: 100,
                        stopLossPercentage: 10,
                    },
                }),
            },
            Object.keys(historiesThatResultInLoss).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
        );

        const expectedData = readLocalFixture<FullTestExpectation>('utils/3.json');

        expect(actual).toEqual(expectedData.result);
        expect(logs).toEqual(expectedData.logs);
        expect(logs.some(l => l.message.includes('Stopping because reached <=0 balance'))).toBeTruthy();
    });

    it('4 - should work as expected when no trade happened', async () => {
        const historiesThatNoTradeHappened = {
            nta: [
                formHistoryEntry({
                    price: 1,
                }),
                formHistoryEntry({
                    price: 1.1,
                }),
            ],
        };
        mockFsReadFileSync(historiesThatNoTradeHappened);

        const actual = await runStrategy(
            runStrategyDeps,
            runStrategyState,
            {
                ...runConfig,
                strategy: new RiseStrategy(logger, {
                    buy: {
                        context: {
                            price: {
                                min: 10,
                            },
                        },
                    },
                }),
            },
            Object.keys(historiesThatNoTradeHappened).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
        );

        expect(actual).toEqual(readLocalFixture<FullTestExpectation>('utils/4.json').result);
    });

    it('5 - should stop checking next mints if remaining balance is less than buy amount', async () => {
        const histories: Record<string, HistoryEntry[]> = {
            fla: [
                // it will buy here as we set all conditions to match the strategy buy config
                formHistoryEntry({
                    timestamp: 1,
                    price: 10,
                }),
                // it will sell here
                formHistoryEntry({
                    timestamp: 2,
                    price: 3,
                }),
            ],
            flb: [
                // should buy here but this will be skipped as won't have enough balance
                formHistoryEntry({
                    timestamp: 1,
                    price: 8,
                }),
            ],
        };
        mockFsReadFileSync(histories);

        const actual = await runStrategy(
            runStrategyDeps,
            runStrategyState,
            {
                ...runConfig,
                strategy: new StupidSniperStrategy(logger, {
                    sell: {
                        takeProfitPercentage: 100,
                        stopLossPercentage: 10,
                    },
                }),
            },
            Object.keys(histories).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
        );

        const expectedData = readLocalFixture<FullTestExpectation>('utils/5.json');

        expect(actual).toEqual(expectedData.result);
        expect(logs).toEqual(expectedData.logs);
        expect(
            logs.some(l =>
                l.message.includes('[0] Stopping because reached balance (0.473145 SOL) <= buyAmount (0.5 SOL)'),
            ),
        ).toBeTruthy();
    });
});

function mockFsReadFileSync(histories: Record<string, HistoryEntry[]>) {
    (mockedFs.readFileSync as jest.Mock).mockImplementation((...args) => {
        const [path] = args;

        const fileNameWithoutExt = basename(path, '.json');
        if (histories[fileNameWithoutExt]) {
            return JSON.stringify({
                mint: fileNameWithoutExt,
                history: histories[fileNameWithoutExt],
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return realFs.readFileSync(...(args as [any, any]));
    });
}
