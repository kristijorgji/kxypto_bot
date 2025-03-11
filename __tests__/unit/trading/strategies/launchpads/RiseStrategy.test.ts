import { createLogger } from 'winston';

import { formSolBoughtOrSold } from '../../../../../src/trading/bots/blockchains/solana/PumpfunBot';
import { TradeTransaction } from '../../../../../src/trading/bots/blockchains/solana/types';
import { MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import RiseStrategy from '../../../../../src/trading/strategies/launchpads/RiseStrategy';

describe(RiseStrategy.name, () => {
    let strategy: RiseStrategy;
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });

    beforeEach(() => {
        strategy = new RiseStrategy(silentLogger);
    });

    const marketContext: MarketContext = {
        price: 100,
        marketCap: 200,
        holdersCount: 300,
        bondingCurveProgress: 50,
        devHoldingPercentage: 5,
        topTenHoldingPercentage: 20,
    };

    const buyTradeTransaction: TradeTransaction = {
        timestamp: Date.now(),
        transactionType: 'buy',
        subCategory: 'newPosition',
        transactionHash: 'ttt',
        walletAddress: 'aaa',
        bought: formSolBoughtOrSold(1),
        sold: formSolBoughtOrSold(1),
        amountRaw: 123,
        grossTransferredLamports: 123,
        netTransferredLamports: 1234,
        price: {
            inSol: 1,
            inLamports: 1e9,
        },
        marketCap: 3.2,
    };

    describe('shouldExit', () => {
        it('should exit if time passed and no pump happened', () => {
            expect(
                strategy.shouldExit(
                    marketContext,
                    [
                        {
                            timestamp: 10,
                            price: 87,
                            marketCap: 100,
                            bondingCurveProgress: 25,
                            holdersCount: 15,
                            devHoldingPercentage: 10,
                            topTenHoldingPercentage: 35,
                        },
                    ],
                    {
                        elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                    },
                ),
            ).toEqual({
                exitCode: 'NO_PUMP',
                message: 'Stopped monitoring token. We waited 300.001 seconds and did not pump',
                shouldSell: false,
            });
        });

        const shouldExitItExitsArgs = [
            {
                price: 3.1355480118319034e-8,
                marketCap: 30,
                holdersCount: 3,
                bondingCurveProgress: 50,
                devHoldingPercentage: 5,
                topTenHoldingPercentage: 20,
            },
            [
                {
                    timestamp: 10,
                    // eslint-disable-next-line no-loss-of-precision
                    price: 3.0355480118319034e-8,
                    marketCap: 31.770000079,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
            ],
            {
                elapsedMonitoringMs: 120 * 1e3 + 1,
            },
        ];

        it('should exit if token is dumped', () => {
            // @ts-ignore
            expect(strategy.shouldExit(...shouldExitItExitsArgs)).toEqual({
                exitCode: 'DUMPED',
                message:
                    'Stopped monitoring token because it was probably dumped and current market cap is less than the initial one',
                shouldSell: false,
            });
        });

        it('should exit if token is dumped and request sell when we have a position', () => {
            strategy.afterBuy(100, buyTradeTransaction);

            // @ts-ignore
            expect(strategy.shouldExit(...shouldExitItExitsArgs)).toEqual({
                exitCode: 'DUMPED',
                message: 'The token is probably dumped and we will sell at loss, sell=true',
                shouldSell: {
                    reason: 'DUMPED',
                },
            });
        });
    });

    describe('shouldSell', () => {
        it('should sell when stop loss is triggered', () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    stopLossPercentage: 10,
                    takeProfitPercentage: 20,
                },
            });

            strategy.afterBuy(10, buyTradeTransaction);

            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 9,
                }),
            ).toEqual({
                reason: 'STOP_LOSS',
            });
        });

        it('should sell when trailing stop loss is triggered', () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    trailingStopLossPercentage: 10,
                    takeProfitPercentage: 30,
                },
            });
            strategy.afterBuy(10, buyTradeTransaction);

            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 12,
                }),
            ).toEqual(false);
            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 10.8,
                }),
            ).toEqual({
                reason: 'TRAILING_STOP_LOSS',
            });
        });

        it('should sell when take profit is triggered', () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    stopLossPercentage: 10,
                    takeProfitPercentage: 20,
                },
            });

            strategy.afterBuy(10, buyTradeTransaction);

            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 12,
                }),
            ).toEqual({
                reason: 'TAKE_PROFIT',
            });
        });

        it('should sell when trailing take profit is triggered', () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    trailingStopLossPercentage: 10,
                    trailingTakeProfit: {
                        profitPercentage: 10,
                        stopPercentage: 10,
                    },
                },
            });
            strategy.afterBuy(10, buyTradeTransaction);

            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 11,
                }),
            ).toEqual(false);
            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 15,
                }),
            ).toEqual(false);
            expect(
                strategy.shouldSell({
                    ...marketContext,
                    price: 13.5,
                }),
            ).toEqual({
                reason: 'TRAILING_TAKE_PROFIT',
            });
        });
    });

    describe('afterBuy', () => {
        it('should return all set limits properly', () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    stopLossPercentage: 10,
                    trailingStopLossPercentage: 12,
                    takeProfitPercentage: 20,
                    trailingTakeProfit: {
                        profitPercentage: 40,
                        stopPercentage: 24,
                    },
                },
            });

            expect(strategy.afterBuy(10, buyTradeTransaction)).toEqual({
                stopLoss: 9,
                trailingStopLossPercentage: 12,
                takeProfit: 12,
                trailingTakeProfit: {
                    trailingProfitPercentage: 40,
                    trailingStopPercentage: 24,
                },
            });
        });
    });
});
