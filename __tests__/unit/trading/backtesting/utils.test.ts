import fs from 'fs';
import { basename } from 'path';

import { LogEntry, createLogger, format } from 'winston';

import Pumpfun from '../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../src/blockchains/solana/dex/pumpfun/types';
import { forceGetPumpCoinInitialData } from '../../../../src/blockchains/solana/dex/pumpfun/utils';
import { solToLamports } from '../../../../src/blockchains/utils/amount';
import { pumpfunRepository } from '../../../../src/db/repositories/PumpfunRepository';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { runStrategy } from '../../../../src/trading/backtesting/utils';
import PumpfunBacktester from '../../../../src/trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig } from '../../../../src/trading/bots/blockchains/solana/types';
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
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

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
    const runConfig: BacktestRunConfig = {
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
            // it will sell here
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
            runConfig,
            Object.keys(histories).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
            {
                verbose: true,
            },
        );

        const expectedData = readLocalFixture<FullTestExpectation>('utils/1/expected.json');

        expect(actual).toEqual(expectedData.result);

        const mockedFsReadFileSync = mockedFs.readFileSync as jest.Mock;
        expect(mockedFsReadFileSync.mock.calls[0]).toEqual(['tmp_test/a.json']);
        expect(mockedFsReadFileSync.mock.calls[2]).toEqual(['tmp_test/b.json']);
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'a');
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'b');
        expect(logs).toEqual(expectedData.logs);
    });

    it('should work as expected when there are holdings left', async () => {
        mockFsReadFileSync(histories);

        const actual = await runStrategy(
            runStrategyDeps,
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

        expect(actual).toEqual({
            totalPnlInSol: -0.523555,
            finalBalanceLamports: 476445000,
            totalHoldingsValueInSol: 0.5502272727272727,
            totalRoi: -52.3555,
            totalTradesCount: 3,
            totalBuyTradesCount: 2,
            totalSellTradesCount: 1,
            winRatePercentage: 50,
            winsCount: 1,
            biggestWinPercentage: 22.128999999999998,
            lossesCount: 1,
            biggestLossPercentage: -126.84,
        });
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

    it('should stop checking next mints if we have no balance left', async () => {
        mockFsReadFileSync(historiesThatResultInLoss);

        const actual = await runStrategy(
            runStrategyDeps,
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

        expect(actual).toEqual({
            totalPnlInSol: -1.0002725,
            finalBalanceLamports: -272500,
            totalHoldingsValueInSol: 0,
            totalRoi: -100.02725,
            totalTradesCount: 4,
            totalBuyTradesCount: 2,
            totalSellTradesCount: 2,
            winRatePercentage: 0,
            winsCount: 0,
            biggestWinPercentage: 0,
            lossesCount: 2,
            biggestLossPercentage: -126.93350000000001,
        });
        expect(logs.some(l => l.message.includes('Stopping because reached <=0 balance'))).toBeTruthy();
    });

    it('should work as expected when no trade happened', async () => {
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
            {
                ...runConfig,
                strategy: new RiseStrategy(logger, {
                    buy: {
                        price: {
                            min: 10,
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

        expect(actual).toEqual({
            totalPnlInSol: 0,
            finalBalanceLamports: 1000000000,
            totalHoldingsValueInSol: 0,
            totalRoi: 0,
            totalTradesCount: 0,
            totalBuyTradesCount: 0,
            totalSellTradesCount: 0,
            winRatePercentage: 0,
            winsCount: 0,
            biggestWinPercentage: 0,
            lossesCount: 0,
            biggestLossPercentage: 0,
        });
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
