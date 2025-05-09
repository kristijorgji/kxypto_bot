import fs from 'fs';

import { LogEntry, createLogger, format } from 'winston';

import { pumpCoinDataToInitialCoinData } from '../../../../src/blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import {
    NewPumpFunTokenData,
    PumpFunCoinData,
    PumpfunInitialCoinData,
} from '../../../../src/blockchains/solana/dex/pumpfun/types';
import PumpfunQueuedListener from '../../../../src/blockchains/solana/dex/PumpfunQueuedListener';
import mockPumpfunQueuedListener from '../../../../src/blockchains/solana/mockPumpfunQueuedListener';
import { solanaConnection } from '../../../../src/blockchains/solana/utils/connection';
import { solToLamports } from '../../../../src/blockchains/utils/amount';
import { db } from '../../../../src/db/knex';
import { pumpfunRepository } from '../../../../src/db/repositories/PumpfunRepository';
import { insertLaunchpadTokenResult } from '../../../../src/db/repositories/tokenAnalytics';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { Config, start } from '../../../../src/scripts/pumpfun/bot';
import {NewPumpFunCoinDataFactory, NewPumpFunTokenDataFactory} from '../../../../src/testdata/factories/pumpfun';
import isTokenCreatorSafe from '../../../../src/trading/bots/blockchains/solana/isTokenCreatorSafe';
import PumpfunBot, {ErrorMessage} from '../../../../src/trading/bots/blockchains/solana/PumpfunBot';
import PumpfunBotEventBus from '../../../../src/trading/bots/blockchains/solana/PumpfunBotEventBus';
import {
    BotExitResponse,
    BotResponse,
    BotTradeResponse,
    TradeTransaction
} from '../../../../src/trading/bots/blockchains/solana/types';
import {readLocalFixture} from '../../../__utils/data';
import {FullTestExpectation} from '../../../__utils/types';

/**
 * 3rd party mocks
 */

jest.mock('@solana/web3.js', () => {
    const actualWeb3 = jest.requireActual('@solana/web3.js');

    return {
        ...actualWeb3,
        Connection: jest.fn(),
    };
});

jest.mock('fs', () => ({
    ...jest.requireActual('fs'), // readFileSync and other fns are needed for test utils
    writeFileSync: jest.fn(),
}));
const mockedFs = fs as jest.Mocked<typeof fs>;

/**
 * Our mocks
 */

jest.mock('../../../../src/utils/functions', () => ({
    ...jest.requireActual('../../../../src/utils/functions'),
    sleep: jest.fn(),
}));

jest.mock('../../../../src/blockchains/solana/utils/connection', () => ({
    ...jest.requireActual('../../../../src/blockchains/solana/utils/connection'),
    solanaConnection: {
        getBalance: jest.fn(),
    },
}));

jest.mock('../../../../src/blockchains/solana/dex/pumpfun/Pumpfun');

jest.mock('../../../../src/blockchains/solana/dex/PumpfunQueuedListener');

jest.mock('../../../../src/db/repositories/PumpfunRepository', () => ({
    ...jest.requireActual('../../../../src/db/repositories/PumpfunRepository'),
    pumpfunRepository: {
        insertToken: jest.fn(),
    },
}));

jest.mock('../../../../src/trading/bots/blockchains/solana/isTokenCreatorSafe', () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock('../../../../src/db/repositories/tokenAnalytics', () => ({
    ...jest.requireActual('../../../../src/db/repositories/tokenAnalytics'),
    insertLaunchpadTokenResult: jest.fn(),
}));

jest.mock('../../../../src/trading/bots/blockchains/solana/PumpfunBot');

jest.mock('../../../../src/db/knex', () => ({
    ...jest.requireActual('../../../../src/db/knex'),
    db: {
        destroy: jest.fn(),
    },
}));

describe('bot', () => {
    function emptyMockReturnsState(): {
        dispatchedPumpfunTokens: NewPumpFunTokenData[];
        returnedCoinDataWithRetries: PumpFunCoinData[];
    } {
        return {
            dispatchedPumpfunTokens: [],
            returnedCoinDataWithRetries: [],
        };
    }

    const logger = createLogger({
        level: 'silly',
        format: format.combine(format.errors({ stack: true }), format.splat(), format.json()),
    })
    let logs: LogEntry[] = [];
    let mockReturnsState = emptyMockReturnsState();

    const pumpfunBotMock = {
        run: jest.fn(),
    };

    const botEventBus = new PumpfunBotEventBus();

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2021-03-19T10:00:00Z'));
    })

    beforeEach(() => {
        logs = [];
        logger
            .clear()
            .add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        (solanaConnection.getBalance as jest.Mock).mockResolvedValue(solToLamports(1.52));

        (PumpfunQueuedListener as jest.Mock).mockImplementation((...args: ConstructorParameters<typeof PumpfunQueuedListener>) => {
            return mockPumpfunQueuedListener(
                args,
                data => mockReturnsState.dispatchedPumpfunTokens.push(data),
                {
                    sleepTime: 500,
                    tokens: [
                        NewPumpFunTokenDataFactory({
                            mint: 'm_1',
                            name: 'token_1',
                            symbol: 'token_1_symbol',
                            user: 'creator_1',
                        }),
                        NewPumpFunTokenDataFactory({
                            mint: 'm_2',
                            name: 'token_2',
                            symbol: 'token_2_symbol',
                            user: 'creator_2',
                        }),
                        NewPumpFunTokenDataFactory({
                            mint: 'm_3',
                            name: 'token_3',
                            symbol: 'token_3_symbol',
                            user: 'creator_3',
                        }),
                    ],
                },
            );
        });

        (Pumpfun as unknown as jest.Mock).mockImplementation(() => {
            return {
                getCoinDataWithRetries: jest.fn((mint: string) => {
                    const t = mockReturnsState.dispatchedPumpfunTokens.find(el => el.mint === mint)!;
                    const r = NewPumpFunCoinDataFactory({
                        mint: t.mint,
                        name: t.name,
                        symbol: t.symbol,
                        bonding_curve: t.bondingCurve,
                        creator: t.user,
                    });
                    mockReturnsState.returnedCoinDataWithRetries.push(r);

                    return r;
                }),
            };
        });

        (PumpfunBot as jest.Mock).mockImplementation(() => pumpfunBotMock);

        (isTokenCreatorSafe as jest.Mock).mockResolvedValue({
            safe: true,
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockReturnsState = emptyMockReturnsState();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    const startConfig: Config = {
        simulate: true,
        maxTokensToProcessInParallel: 10,
        buyMonitorWaitPeriodMs: 1000,
        sellMonitorWaitPeriodMs: 250,
        maxWaitMonitorAfterResultMs: 120 * 1e3,
        buyInSol: 0.4,
        maxFullTrades: null,
        stopAtMinWalletBalanceLamports: null,
    }

    const startDeps = {
        logger: logger,
        botEventBus: botEventBus,
    };

    it('1 - should receive tokens, create bots for each of them and store the results', async () => {
        pumpfunBotMock.run.mockImplementation(async (_: string, initialCoinData: PumpfunInitialCoinData): Promise<BotResponse> => {
            let netPnlInSol: number | undefined;
            if (initialCoinData.mint === mockReturnsState.returnedCoinDataWithRetries[0].mint) {
                netPnlInSol = 0.534;
            } else if (initialCoinData.mint === mockReturnsState.returnedCoinDataWithRetries[1].mint) {
                netPnlInSol = 0.772;
            }

            if (netPnlInSol) {
                const buyTransaction = {
                    transactionType: 'buy',
                    netTransferredLamports: -solToLamports(startConfig.buyInSol!),
                } as TradeTransaction;
                botEventBus.tradeExecuted(buyTransaction);

                const sellTransaction = {
                    transactionType: 'sell',
                    netTransferredLamports: solToLamports(startConfig.buyInSol! + netPnlInSol),
                } as TradeTransaction;
                botEventBus.tradeExecuted(sellTransaction);

                const botTradeResponse: BotTradeResponse = {
                    netPnl: {
                        inSol: netPnlInSol,
                        inLamports: solToLamports(netPnlInSol),
                    },
                    transactions: [buyTransaction, sellTransaction],
                    history: [],
                };
                botEventBus.botTradeResponse(botTradeResponse);

                return botTradeResponse;
            }

            return {
                exitCode: 'DUMPED',
                exitReason:
                    'Stopped monitoring token because it was probably dumped and current market cap is less than the initial one',
                history: [],
                // eslint-disable-next-line prettier/prettier
            } satisfies BotExitResponse;
        });

        await start(startConfig, startDeps);

        const expected = readLocalFixture<FullTestExpectation>('bot/1');

        expect((pumpfunRepository.insertToken as jest.Mock)).toHaveBeenCalledTimes(3);
        expect((pumpfunRepository.insertToken as jest.Mock).mock.calls).toEqual([
            [pumpCoinDataToInitialCoinData(mockReturnsState.returnedCoinDataWithRetries[0])],
            [pumpCoinDataToInitialCoinData(mockReturnsState.returnedCoinDataWithRetries[1])],
            [pumpCoinDataToInitialCoinData(mockReturnsState.returnedCoinDataWithRetries[2])],
        ]);

        expect(isTokenCreatorSafe as jest.Mock).toHaveBeenCalledTimes(3);
        expect((isTokenCreatorSafe as jest.Mock).mock.calls).toEqual(expected.fnsCallArgs.isTokenCreatorSafe);

        expect(pumpfunBotMock.run).toHaveBeenCalledTimes(3)

        expect(mockedFs.writeFileSync as jest.Mock).toHaveBeenCalledTimes(3);
        expect((mockedFs.writeFileSync as jest.Mock).mock.calls).toEqual(expected.fnsCallArgs['fs.writeFileSync']);

        expect(insertLaunchpadTokenResult as jest.Mock).toHaveBeenCalledTimes(3);
        expect((insertLaunchpadTokenResult as jest.Mock).mock.calls).toEqual(expected.fnsCallArgs.insertLaunchpadTokenResult);

        expect(db.destroy as jest.Mock).toHaveBeenCalledTimes(1);

        expect(logs).toEqual(expected.logs);
    });

    it('2 - should handle correctly not safe token creator', async () => {
        (isTokenCreatorSafe as jest.Mock).mockResolvedValue({
            safe: false,
            reason: 'already_flagged',
        });

        await start(startConfig, startDeps);

        const expected = readLocalFixture<FullTestExpectation>('bot/2');

        expect(pumpfunBotMock.run).not.toHaveBeenCalled();

        expect(mockedFs.writeFileSync as jest.Mock).toHaveBeenCalledTimes(3);
        expect((mockedFs.writeFileSync as jest.Mock).mock.calls).toEqual(expected.fnsCallArgs['fs.writeFileSync']);
    });

    xit('3 - should stop all bots when the trade manager reaches maxFullTrades', async () => {
        // TODO
    });

    xit('4 - should stop all bots when the trade manager reaches minWalletBalanceLamports', () => {
        // TODO
        // assert botEventBus.onStopBot is called
    });

    it('5 - should stop all bots when one bot run throws insufficient funds error', async () => {
        let timesCalledBusStopBot = 0;
        botEventBus.onStopBot(() => {
            timesCalledBusStopBot++;
        })

        pumpfunBotMock.run.mockImplementation(async (): Promise<BotResponse> => {
            if (timesCalledBusStopBot === 0) {
                throw new Error(ErrorMessage.insufficientFundsToBuy);
            } else {
                return {
                    exitCode: 'STOPPED',
                    exitReason: 'The bot was requested to stop',
                    history: [],
                };
            }
        });

        await start({
            ...startConfig,
            maxFullTrades: 1,
        }, startDeps);

        const expected = readLocalFixture<FullTestExpectation>('bot/5');

        expect(pumpfunBotMock.run).toHaveBeenCalledTimes(3);
        expect(timesCalledBusStopBot).toEqual(2);

        expect(mockedFs.writeFileSync as jest.Mock).toHaveBeenCalledTimes(1);
        expect((mockedFs.writeFileSync as jest.Mock).mock.calls).toEqual(expected.fnsCallArgs['fs.writeFileSync']);

        expect(logs).toEqual(expected.logs);
    });
});
