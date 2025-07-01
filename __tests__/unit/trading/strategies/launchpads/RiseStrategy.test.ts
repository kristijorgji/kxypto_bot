import { createLogger } from 'winston';

import { formSolBoughtOrSold } from '../../../../../src/trading/bots/blockchains/solana/PumpfunBot';
import { HistoryRef, TradeTransaction } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import RiseStrategy, { RiseStrategyConfig } from '../../../../../src/trading/strategies/launchpads/RiseStrategy';
import { LaunchpadBuyPosition } from '../../../../../src/trading/strategies/types';
import { formHistoryEntry } from '../../../../__utils/blockchains/solana';
import { readFixture } from '../../../../__utils/data';

describe(RiseStrategy.name, () => {
    let strategy: RiseStrategy;
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });

    beforeEach(() => {
        strategy = new RiseStrategy(silentLogger);
    });

    const mint = '2By2AVdjSfxoihhqy6Mm4nzz6uXEZADKEodiyQ1RZzTx';

    const marketContext: MarketContext = {
        price: 100,
        marketCap: 200,
        holdersCount: 300,
        bondingCurveProgress: 50,
        devHoldingPercentage: 5,
        topTenHoldingPercentage: 20,
        devHoldingPercentageCirculating: 20,
        topTenHoldingPercentageCirculating: 70,
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

    const launchpadBuyPosition: LaunchpadBuyPosition = {
        marketContext: marketContext,
        transaction: buyTradeTransaction,
    };

    const historyRef: HistoryRef = {
        timestamp: 1740056426861,
        index: 10,
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
                            devHoldingPercentageCirculating: 20,
                            topTenHoldingPercentageCirculating: 70,
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
                    'Stopped monitoring token because it was probably dumped less_mc_and_few_holders and current market cap is less than the initial one',
                shouldSell: false,
            });
        });

        it('should exit if token is dumped and request sell when we have a position', () => {
            strategy.afterBuy(100, launchpadBuyPosition);

            // @ts-ignore
            expect(strategy.shouldExit(...shouldExitItExitsArgs)).toEqual({
                exitCode: 'DUMPED',
                message: 'The token is probably dumped less_mc_and_few_holders and we will sell at loss, sell=true',
                shouldSell: {
                    reason: 'DUMPED',
                },
            });
        });

        it('should exit if token is dumped and holders now are less than before max', () => {
            expect(
                strategy.shouldExit(
                    {
                        price: 3.1355480118319034e-8,
                        marketCap: 30.9,
                        holdersCount: 3,
                        bondingCurveProgress: 50,
                        devHoldingPercentage: 5,
                        topTenHoldingPercentage: 20,
                        devHoldingPercentageCirculating: 20,
                        topTenHoldingPercentageCirculating: 70,
                    },
                    [
                        formHistoryEntry({
                            marketCap: 31,
                            holdersCount: 1,
                        }),
                        formHistoryEntry({
                            marketCap: 32,
                            holdersCount: 4,
                        }),
                        formHistoryEntry({
                            marketCap: 30.9,
                            holdersCount: 3,
                        }),
                    ],
                    {
                        elapsedMonitoringMs: 60 * 1e3,
                    },
                ),
            ).toEqual({
                exitCode: 'DUMPED',
                message:
                    'Stopped monitoring token because it was probably dumped less_holders_and_mc_than_initial and current market cap is less than the initial one',
                shouldSell: false,
            });
        });
    });

    describe('shouldSell', () => {
        const history: HistoryEntry[] = [];

        it('should sell when stop loss is triggered', async () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    stopLossPercentage: 10,
                    takeProfitPercentage: 20,
                },
            });

            strategy.afterBuy(10, launchpadBuyPosition);

            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 9,
                    },
                    history,
                ),
            ).toEqual({
                reason: 'STOP_LOSS',
            });
        });

        it('should sell when trailing stop loss is triggered', async () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    trailingStopLossPercentage: 10,
                    takeProfitPercentage: 30,
                },
            });
            strategy.afterBuy(10, launchpadBuyPosition);

            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 12,
                    },
                    history,
                ),
            ).toEqual(false);
            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 10.8,
                    },
                    history,
                ),
            ).toEqual({
                reason: 'TRAILING_STOP_LOSS',
            });
        });

        it('should sell when take profit is triggered', async () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    stopLossPercentage: 10,
                    takeProfitPercentage: 20,
                },
            });

            strategy.afterBuy(10, launchpadBuyPosition);

            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 12,
                    },
                    history,
                ),
            ).toEqual({
                reason: 'TAKE_PROFIT',
            });
        });

        it('should sell when trailing take profit is triggered', async () => {
            strategy = new RiseStrategy(silentLogger, {
                sell: {
                    trailingStopLossPercentage: 10,
                    trailingTakeProfit: {
                        profitPercentage: 10,
                        stopPercentage: 10,
                    },
                },
            });
            strategy.afterBuy(10, launchpadBuyPosition);

            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 11,
                    },
                    history,
                ),
            ).toEqual(false);
            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 15,
                    },
                    history,
                ),
            ).toEqual(false);
            expect(
                await strategy.shouldSell(
                    mint,
                    historyRef,
                    {
                        ...marketContext,
                        price: 13.5,
                    },
                    history,
                ),
            ).toEqual({
                reason: 'TRAILING_TAKE_PROFIT',
            });
        });

        it('should sell when dev and top 10 insiders increase position after we bought', async () => {
            const history: HistoryEntry[] = readFixture<{ history: HistoryEntry[] }>(
                'backtest/pumpfun/B6eQdRcdYhuFxXKx75jumoMGkZCE4LCeobSDgZNzpump',
            ).history;

            const buyEntryIndex = 36;

            strategy = new RiseStrategy(silentLogger, {
                variant: 'hc_12_bcp_22_dhp_7_tthp_5_tslp_10_tpp_17',
                buy: {
                    holdersCount: { min: 12 },
                    bondingCurveProgress: { min: 22 },
                    devHoldingPercentage: { max: 7 },
                    topTenHoldingPercentage: { max: 5 },
                },
                sell: {
                    takeProfitPercentage: 17,
                    trailingStopLossPercentage: 10,
                },
                maxWaitMs: 7 * 60 * 1e3,
                priorityFeeInSol: 0.005,
                buySlippageDecimal: 0.25,
                sellSlippageDecimal: 0.25,
            });
            strategy.afterBuy(1.8959502681185026e-7, {
                marketContext: history[buyEntryIndex] as MarketContext,
                transaction: buyTradeTransaction,
            });

            let firstSellIndex = -1;
            for (let i = buyEntryIndex; i < history.length; i++) {
                const shouldSellRes = await strategy.shouldSell(mint, historyRef, history[i], history);
                if (shouldSellRes) {
                    firstSellIndex = i;
                    expect(shouldSellRes).toEqual({
                        reason: 'NO_LONGER_MEETS_ENTRY_RULES',
                    });
                    break;
                }
            }
            expect(firstSellIndex).toEqual(878);
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

            expect(strategy.afterBuy(10, launchpadBuyPosition)).toEqual({
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

    describe('formVariant', () => {
        function getVariant(customConfig: Partial<RiseStrategyConfig> = {}) {
            return new RiseStrategy(silentLogger, customConfig).config.variant;
        }

        it('should full variant key with all values', () => {
            const key = getVariant({
                maxWaitMs: 500,
                buySlippageDecimal: 0.5,
                sellSlippageDecimal: 0.4,
                buyPriorityFeeInSol: 0.03,
                sellPriorityFeeInSol: 0.07,
                buy: {
                    holdersCount: {
                        min: 1,
                        max: 2,
                    },
                    marketCap: {
                        min: 2,
                        max: 77,
                    },
                },
                sell: {
                    takeProfitPercentage: 10,
                    trailingStopLossPercentage: 15,
                    stopLossPercentage: 33,
                    trailingTakeProfit: {
                        profitPercentage: 30,
                        stopPercentage: 5,
                    },
                },
            });
            expect(key).toBe('buy(hc:l1-h2_mc:l2-h77)_sell(tpp:10_tslp:15_slp:33_ttp(pp:30:sp:5))');
        });

        it('should exclude undefined values and use defaults', () => {
            const key = getVariant({
                buy: {
                    bondingCurveProgress: {
                        min: 30,
                    },
                },
            });
            expect(key).toBe('buy(bcp:l30)_sell(tslp:15_tpp:15)');
        });
    });
});
