import fs from 'fs';
import { basename } from 'path';

import { LogEntry, createLogger } from 'winston';

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
import { readFixture } from '../../../__utils/data';

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
        useRandomizedValues: false,
        onlyOneFullTrade: true,
        allowNegativeBalance: false,
        sellUnclosedPositionsAtEnd: false,
    };

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true }));

        (forceGetPumpCoinInitialData as jest.Mock).mockImplementation((...args) => {
            return Promise.resolve({
                ...readFixture<PumpfunInitialCoinData>('dex/pumpfun/get-coin-data'),
                mint: args[2],
            });
        });
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

    it('should work as expected when there are no holdings left', async () => {
        mockFsReadFileSync(histories);

        const actual = await runStrategy(
            runStrategyDeps,
            runConfig,
            Object.keys(histories).map(key => ({
                fullPath: `tmp_test/${key}.json`,
                name: `${key}.json`,
                creationTime: new Date(),
            })),
        );

        expect(actual).toEqual({
            totalPnlInSol: -0.11603954545454549,
            totalHoldingsValueInSol: 0,
            totalRoi: -11.603954545454553,
            totalTradesCount: 4,
            totalBuyTradesCount: 2,
            totalSellTradesCount: 2,
            winRatePercentage: 50,
            winsCount: 1,
            biggestWinPercentage: 22.128999999999998,
            lossesCount: 1,
            biggestLossPercentage: -45.3369090909091,
        });

        const mockedFsReadFileSync = mockedFs.readFileSync as jest.Mock;
        expect(mockedFsReadFileSync.mock.calls[0]).toEqual(['tmp_test/a.json']);
        expect(mockedFsReadFileSync.mock.calls[2]).toEqual(['tmp_test/b.json']);
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'a');
        expect(forceGetPumpCoinInitialData as jest.Mock).toHaveBeenCalledWith(pumpfun, pumpfunRepository, 'b');
        expect(logs.length).toEqual(2);
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
            totalHoldingsValueInSol: 0.5502272727272727,
            totalRoi: -52.355500000000006,
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
                price: 0.5,
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
                price: 2,
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

    it('should stop checking next mints if we have no balance left and runConfig.allowNegativeBalance = false', async () => {
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
            totalPnlInSol: -1.16621,
            totalHoldingsValueInSol: 0,
            totalRoi: -116.621,
            totalTradesCount: 4,
            totalBuyTradesCount: 2,
            totalSellTradesCount: 2,
            winRatePercentage: 0,
            winsCount: 0,
            biggestWinPercentage: 0,
            lossesCount: 2,
            biggestLossPercentage: -124.121,
        });
        expect(logs.some(l => l.message.includes('Stopping because reached <=0 balance'))).toBeTruthy();
    });

    it('should continue with next mints as expected when runConfig.allowNegativeBalance = true and balance is negative', async () => {
        mockFsReadFileSync(historiesThatResultInLoss);

        const actual = await runStrategy(
            runStrategyDeps,
            {
                ...runConfig,
                allowNegativeBalance: true,
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
            totalPnlInSol: -1.743065,
            totalHoldingsValueInSol: 0,
            totalRoi: -174.3065,
            totalTradesCount: 6,
            totalBuyTradesCount: 3,
            totalSellTradesCount: 3,
            winRatePercentage: 0,
            winsCount: 0,
            biggestWinPercentage: 0,
            lossesCount: 3,
            biggestLossPercentage: -124.121,
        });
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
