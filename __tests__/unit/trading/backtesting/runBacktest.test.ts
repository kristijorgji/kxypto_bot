import fs from 'fs';

import redisMock from 'ioredis-mock';
import { LogEntry, format } from 'winston';

import { randomizationNoneConfig } from './data';
import Pumpfun from '../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../src/blockchains/solana/dex/pumpfun/types';
import { forceGetPumpCoinInitialData } from '../../../../src/blockchains/solana/dex/pumpfun/utils';
import { ActionSource, ActorContext } from '../../../../src/core/types';
import { getFiles } from '../../../../src/data/getFiles';
import {
    initBacktestStrategyResult,
    updateBacktestRunStatus,
    updateBacktestStrategyResult,
} from '../../../../src/db/repositories/backtests';
import { Backtest, BacktestStrategyResult, ProcessingStatus } from '../../../../src/db/types';
import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { ProtoBacktestRun } from '../../../../src/protos/generated/backtests';
import BacktestPubSub from '../../../../src/pubsub/BacktestPubSub';
import MemoryPubSub from '../../../../src/pubsub/MemoryPubSub';
import { BacktestStrategyResultFactory } from '../../../../src/testdata/factories/db/backtests';
import { ProtoBacktestRunFactory } from '../../../../src/testdata/factories/proto/backtests';
import runBacktest, {
    strategyMintBacktestResultToDraftMintResult,
} from '../../../../src/trading/backtesting/runBacktest';
import { RunBacktestParams } from '../../../../src/trading/backtesting/types';
import PumpfunBacktester from '../../../../src/trading/bots/blockchains/solana/PumpfunBacktester';
import { StrategyBacktestResult } from '../../../../src/trading/bots/blockchains/solana/types';
import RiseStrategy from '../../../../src/trading/strategies/launchpads/RiseStrategy';
import { deepClone } from '../../../../src/utils/data/data';
import { FirstArg } from '../../../../src/utils/types';
import { UpdateItem } from '../../../../src/ws-api/types';
import { rawFixture, readFixture, readLocalFixture } from '../../../__utils/data';
import { mockFsReadFileSync, mockGetFiles } from '../../../__utils/data-mocks';

const realFs = jest.requireActual('fs');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn(),
}));
const mockedFs = fs as jest.Mocked<typeof fs>;

jest.mock('@src/data/getFiles');

jest.mock('@src/db/repositories/backtests', () => ({
    ...jest.requireActual('@src/db/repositories/backtests'),
    initBacktestStrategyResult: jest.fn(),
    updateBacktestStrategyResult: jest.fn(),
    updateBacktestRunStatus: jest.fn(),
}));

jest.mock('@src/blockchains/solana/dex/pumpfun/utils', () => ({
    ...jest.requireActual('@src/blockchains/solana/dex/pumpfun/utils'),
    forceGetPumpCoinInitialData: jest.fn(),
}));

const dummyDate = new Date('2021-03-19T10:00:00Z');

describe('runBacktest', () => {
    let logs: LogEntry[] = [];
    const pubSub = new MemoryPubSub();
    const redisMockInstance = new redisMock();

    const runnerDeps: FirstArg<typeof runBacktest> = {
        logger: logger,
        pubsub: pubSub,
        backtestPubSub: new BacktestPubSub(pubSub),
        pumpfun: new Pumpfun({
            rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        }),
        backtester: new PumpfunBacktester(logger),
    };

    const actorContext: ActorContext = {
        source: ActionSource.App,
        userId: 'kristi-777-icxc',
    };

    const backtest: Backtest = {
        id: '09af94c8-aead-455a-a789-dcfbf84e9144',
        name: 't_1000_1',
        chain: 'solana',
        config: {
            initialBalanceLamports: 1e9,
            buyAmountSol: 1,
            data: {
                path: './backtests/ktest',
                filesCount: 1,
            },
            jitoConfig: {
                jitoEnabled: true,
            },
            randomization: randomizationNoneConfig,
            onlyOneFullTrade: true,
            sellUnclosedPositionsAtEnd: true,
        },
        created_at: dummyDate,
    };

    const backtestRun: ProtoBacktestRun = ProtoBacktestRunFactory({
        id: 777,
        backtest_id: backtest.id,
        source: actorContext.source,
        status: ProcessingStatus.Pending,
        user_id: actorContext.userId,
        api_client_id: undefined,
        started_at: undefined,
        finished_at: undefined,
        failure_details: undefined,
        created_at: dummyDate,
    });

    const config: RunBacktestParams = {
        strategies: [
            new RiseStrategy(logger, {
                buy: {
                    derivedContext: {
                        timeFromStartS: {
                            min: 600, // never buy
                        },
                    },
                },
            }),
            new RiseStrategy(logger, {
                buy: {
                    derivedContext: {
                        timeFromStartS: {
                            min: 601, // never buy
                        },
                    },
                },
            }),
        ],
        backtestRun: backtestRun,
        backtest: backtest,
    };

    const fileToContent = {
        [`${config.backtest.config.data.path}/a.json`]: rawFixture(
            'backtest/pumpfun/2avW4NVGVVXgTYKpqV38MBwwypshjQxyp1W2utKkpump',
            realFs.readFileSync,
        ),
    };

    const initialReceivedPubSub: { runs: unknown[]; strategyResults: unknown[]; mintResults: unknown[] } = {
        runs: [],
        strategyResults: [],
        mintResults: [],
    };
    let receivedPubSub: typeof initialReceivedPubSub;

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(dummyDate);
    });

    beforeEach(async () => {
        logs = [];
        logger.level = 'silly';
        logger.clear().add(new ArrayTransport({ array: logs, json: false, format: format.splat() }));

        (forceGetPumpCoinInitialData as jest.Mock).mockImplementation((...args) => {
            return Promise.resolve({
                ...readFixture<PumpfunInitialCoinData>('dex/pumpfun/get-coin-data'),
                mint: args[2],
            });
        });

        receivedPubSub = deepClone(initialReceivedPubSub);
        await runnerDeps.backtestPubSub.subscribeAllRuns(data => {
            receivedPubSub.runs.push(data);
        });
        await runnerDeps.backtestPubSub.subscribeAllStrategyResults(data => {
            receivedPubSub.strategyResults.push(data);
        });
        await runnerDeps.backtestPubSub.subscribeAllMintsResults(data => {
            receivedPubSub.mintResults.push(data);
        });
    });

    afterEach(() => {
        redisMockInstance.flushall();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    it('1 - should work when existing run is provided and should store all, and dispatch all events', async () => {
        mockFsReadFileSync(mockedFs, realFs, fileToContent);
        mockGetFiles(getFiles as jest.Mock, fileToContent);

        const strategiesCount = config.strategies.length;

        const returnedBsrs = Array.from({ length: strategiesCount }, () =>
            BacktestStrategyResultFactory({
                backtest_id: backtest.id,
                backtest_run_id: backtestRun.id,
                created_at: dummyDate,
                updated_at: dummyDate,
            }),
        );
        for (let i = 0; i < strategiesCount; i++) {
            (initBacktestStrategyResult as jest.Mock).mockResolvedValueOnce(returnedBsrs[i]);
            (updateBacktestStrategyResult as jest.Mock).mockReturnValueOnce({
                ...returnedBsrs[i],
                status: ProcessingStatus.Completed,
            } satisfies BacktestStrategyResult);
        }

        const runFinishedAt = new Date('2021-03-19T11:07:10Z');
        (updateBacktestRunStatus as jest.Mock)
            .mockResolvedValueOnce({
                ...backtestRun,
                status: ProcessingStatus.Running,
                finished_at: undefined,
            } satisfies ProtoBacktestRun)
            .mockResolvedValueOnce({
                ...backtestRun,
                status: ProcessingStatus.Completed,
                finished_at: runFinishedAt,
            } satisfies ProtoBacktestRun);

        // Mock process.hrtime to return the start time first, then the end time
        const hrtimeMock = jest
            .spyOn(process, 'hrtime')
            .mockReturnValueOnce([100, 0]) // 1st call: startTime
            .mockReturnValueOnce([1, 200000000]) // 2nd call: strategyStartTime 1.2s later
            .mockReturnValueOnce([1, 400000000]) // 3nd call: executionTime 1.4s later
            .mockReturnValueOnce([2, 200000000])
            .mockReturnValueOnce([3, 500000000])
            .mockReturnValueOnce([5, 200000000]);

        await expect(runBacktest(runnerDeps, actorContext, config, { aborted: false })).resolves.not.toThrow();

        expect(updateBacktestRunStatus as jest.Mock).toHaveBeenNthCalledWith(
            1,
            config.backtestRun.id,
            ProcessingStatus.Running,
        );
        expect(receivedPubSub.runs[0]).toEqual({
            action: 'updated',
            data: {
                ...config.backtestRun,
                finished_at: undefined,
                status: 'running',
            },
            id: config.backtestRun.id.toString(),
            version: 1,
        } satisfies UpdateItem<ProtoBacktestRun>);

        const expectedRunStrategyResult: StrategyBacktestResult = {
            biggestLossPercentage: 0,
            biggestWinPercentage: 0,
            finalBalanceLamports: 1000000000,
            highestPeakLamports: 1000000000,
            lossesCount: 0,
            lowestTroughLamports: 1000000000,
            maxDrawdownPercentage: 0,
            mintResults: {
                '2avW4NVGVVXgTYKpqV38MBwwypshjQxyp1W2utKkpump': {
                    backtestResponse: {
                        events: [
                            {
                                action: 'botExit',
                                historyRef: {
                                    index: 0,
                                    timestamp: 1767461807193,
                                },
                                reason: 'no_funds_to_buy',
                            },
                        ],
                        finalBalanceLamports: 1000000000,
                        holdings: {
                            amountRaw: 0,
                            lamportsValue: 0,
                        },
                        maxDrawdownPercentage: 0,
                        profitLossLamports: 0,
                        roi: 0,
                        tradeHistory: [],
                    },
                    createdAt: new Date('2021-03-19T10:00:00.000Z'),
                    index: 0,
                    mint: '2avW4NVGVVXgTYKpqV38MBwwypshjQxyp1W2utKkpump',
                    mintFilePath: Object.keys(fileToContent)[0],
                    mintFileStorageType: 'local',
                },
            },
            totalBuyTradesCount: 0,
            totalHoldingsValueInSol: 0,
            totalPnlInSol: 0,
            totalRoi: 0,
            totalSellTradesCount: 0,
            totalTradesCount: 0,
            winRatePercentage: 0,
            winsCount: 0,
        };

        let pubsubStrategiesAccessCounter = 0;
        for (let i = 0; i < strategiesCount; i += 1) {
            expect(initBacktestStrategyResult as jest.Mock).toHaveBeenNthCalledWith(
                i + 1,
                config.backtest.id,
                config.backtestRun.id,
                config.strategies[i],
                ProcessingStatus.Running,
            );
            expect(receivedPubSub.strategyResults[pubsubStrategiesAccessCounter++]).toEqual({
                action: 'added',
                data: returnedBsrs[i],
                id: returnedBsrs[i].id.toString(),
                version: 1,
            } satisfies UpdateItem<BacktestStrategyResult>);

            expect(updateBacktestStrategyResult as jest.Mock).toHaveBeenNthCalledWith(
                i + 1,
                returnedBsrs[i].id,
                ProcessingStatus.Completed,
                expectedRunStrategyResult,
                i === 0 ? 1.4 : 3.5,
                {
                    storeMintsResults: true,
                },
            );
            expect(receivedPubSub.strategyResults[pubsubStrategiesAccessCounter++]).toEqual({
                action: 'updated',
                data: {
                    ...returnedBsrs[i],
                    status: ProcessingStatus.Completed,
                },
                id: returnedBsrs[i].id.toString(),
                version: 2,
            } satisfies UpdateItem<BacktestStrategyResult>);
        }
        expect(initBacktestStrategyResult as jest.Mock).toHaveBeenCalledTimes(strategiesCount);
        expect(updateBacktestStrategyResult as jest.Mock).toHaveBeenCalledTimes(strategiesCount);
        expect(receivedPubSub.strategyResults.length).toEqual(strategiesCount * 2);
        expect(receivedPubSub.mintResults).toEqual(
            Object.values(expectedRunStrategyResult.mintResults).flatMap(value =>
                returnedBsrs.map(rbsr => strategyMintBacktestResultToDraftMintResult(rbsr.id, value)),
            ),
        );

        expect(updateBacktestRunStatus as jest.Mock).toHaveBeenNthCalledWith(
            2,
            config.backtestRun.id,
            ProcessingStatus.Completed,
            undefined,
        );
        expect(updateBacktestRunStatus as jest.Mock).toHaveBeenCalledTimes(2);
        expect(receivedPubSub.runs[1]).toEqual({
            action: 'updated',
            data: {
                ...config.backtestRun,
                finished_at: runFinishedAt,
                status: 'completed',
            },
            id: config.backtestRun.id.toString(),
            version: 2,
        } satisfies UpdateItem<ProtoBacktestRun>);
        expect(receivedPubSub.runs.length).toEqual(2);

        expect(logs).toEqual(readLocalFixture('runBacktest/1-expected-logs'));

        hrtimeMock.mockRestore();
    });
});
