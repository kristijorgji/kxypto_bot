import { createLogger } from 'winston';

import { formSolBoughtOrSold } from '../../../../../src/trading/bots/blockchains/solana/PumpfunBot';
import { TradeTransaction } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import { HistoryRef, ShouldExitMonitoringResponse, ShouldSellResponse } from '../../../../../src/trading/bots/types';
import { shouldExitLaunchpadToken } from '../../../../../src/trading/strategies/launchpads/common';
import RiseStrategy, { RiseStrategyConfig } from '../../../../../src/trading/strategies/launchpads/RiseStrategy';
import { LaunchpadBuyPosition } from '../../../../../src/trading/strategies/types';
import { formHistoryEntry } from '../../../../__utils/blockchains/solana';
import { readFixture } from '../../../../__utils/data';

jest.mock('../../../../../src/trading/strategies/launchpads/common', () => ({
    ...jest.requireActual('../../../../../src/trading/strategies/launchpads/common'),
    shouldExitLaunchpadToken: jest.fn(),
}));

const mockShouldExitLaunchpadToken = shouldExitLaunchpadToken as jest.Mock;

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
        topHolderCirculatingPercentage: 12,
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
        it('calls shouldExitLaunchpadToken with correct props', () => {
            const shouldExitResponse: ShouldExitMonitoringResponse = {
                exitCode: 'NO_PUMP',
                message: 'Stopped monitoring token. We waited 300.001 seconds and did not pump',
                shouldSell: false,
            };
            mockShouldExitLaunchpadToken.mockReturnValue(shouldExitResponse satisfies ShouldExitMonitoringResponse);
            const history = [formHistoryEntry()];

            expect(
                strategy.shouldExit(marketContext, history, {
                    elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                }),
            ).toEqual(shouldExitResponse);

            expect(mockShouldExitLaunchpadToken).toHaveBeenCalledTimes(1);
            expect(mockShouldExitLaunchpadToken).toHaveBeenCalledWith(
                marketContext,
                history,
                {
                    elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                },
                undefined,
                5 * 60 * 1e3,
            );
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
                sell: true,
                reason: 'STOP_LOSS',
            } satisfies ShouldSellResponse);
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
            ).toEqual({
                sell: false,
                reason: 'meets_entry_rules',
            } satisfies ShouldSellResponse);
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
                sell: true,
                reason: 'TRAILING_STOP_LOSS',
            } satisfies ShouldSellResponse);
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
                sell: true,
                reason: 'TAKE_PROFIT',
            } satisfies ShouldSellResponse);
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
            ).toEqual({
                sell: false,
                reason: 'meets_entry_rules',
            } satisfies ShouldSellResponse);
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
            ).toEqual({
                sell: false,
                reason: 'meets_entry_rules',
            } satisfies ShouldSellResponse);
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
                sell: true,
                reason: 'TRAILING_TAKE_PROFIT',
            } satisfies ShouldSellResponse);
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
                if (shouldSellRes.sell) {
                    firstSellIndex = i;
                    expect(shouldSellRes).toEqual({
                        sell: true,
                        reason: 'NO_LONGER_MEETS_ENTRY_RULES',
                    } satisfies ShouldSellResponse);
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
