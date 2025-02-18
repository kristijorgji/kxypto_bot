import { Logger } from 'winston';

import {
    BacktestExitResponse,
    BacktestRunConfig,
    BacktestTradeResponse,
    BuyPosition,
    SellPosition,
    Trade,
} from './types';
import { PumpfunInitialCoinData } from '../../../../blockchains/solana/dex/pumpfun/types';
import { lamportsToSol, solToLamports } from '../../../../blockchains/utils/amount';
import { HistoryEntry } from '../../launchpads/types';
import { SellReason } from '../../types';

export default class PumpfunBacktester {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly logger: Logger) {}

    async run(
        { initialBalanceLamports, buyAmountSol, strategy, onlyOneFullTrade }: BacktestRunConfig,
        tokenInfo: PumpfunInitialCoinData,
        history: HistoryEntry[],
    ): Promise<BacktestTradeResponse | BacktestExitResponse> {
        let balanceLamports = initialBalanceLamports;
        let holdings = 0;
        const tradeHistory: Trade[] = [];
        let peakBalanceLamports = initialBalanceLamports; // Tracks the highest balanceLamports achieved
        let maxDrawdown = 0; // Tracks max drawdown from peak
        const buyAmountLamports = solToLamports(buyAmountSol);

        let sell:
            | {
                  reason: SellReason;
              }
            | undefined;

        for (const marketContext of history) {
            const { price, marketCap } = marketContext;

            // no more money for further purchases, and also we have no position
            if (balanceLamports < buyAmountLamports && !strategy.buyPosition) {
                break;
            }

            if (
                balanceLamports > buyAmountLamports &&
                !strategy.buyPosition &&
                strategy.shouldBuy(marketContext, history)
            ) {
                /**
                 * TODO consider fees as well simulate them
                 * fast forward marketContext to next one after interval after simulating possible buy execution time
                 */
                holdings += buyAmountSol / price;
                balanceLamports -= buyAmountLamports;

                const buyPosition: BuyPosition = {
                    timestamp: Date.now(),
                    amountRaw: holdings,
                    grossReceivedLamports: -buyAmountLamports,
                    netTransferredLamports: -buyAmountLamports,
                    price: {
                        inLamports: solToLamports(price),
                        inSol: price,
                    },
                    marketCap: marketCap,
                };
                tradeHistory.push({
                    buyPosition: buyPosition,
                    sellPositions: [],
                    netPnl: {
                        inLamports: -1,
                        inSol: -1,
                    },
                });
                strategy.afterBuy(price, buyPosition);
            }

            if (!strategy.buyPosition) {
                const shouldExitRes = strategy.shouldExit(marketContext, history, {
                    elapsedMonitoringMs: marketContext.timestamp - history[0].timestamp,
                });
                if (shouldExitRes) {
                    if (shouldExitRes.shouldSell) {
                        sell = {
                            reason: shouldExitRes.shouldSell.reason,
                        };
                    } else {
                        return {
                            exitCode: shouldExitRes.exitCode,
                            exitReason: shouldExitRes.message,
                        };
                    }
                }
            }

            if (strategy.buyPosition) {
                const shouldSellRes = strategy.shouldSell(marketContext, history);
                if (shouldSellRes !== false) {
                    sell = {
                        reason: shouldSellRes.reason,
                    };
                }
            }

            if (sell && strategy.buyPosition) {
                /**
                 * TODO calculate properly
                 *  gross and net received lamports
                 *  include fee simulation into them
                 *  fast forward history based on simulated execution delay of the sell
                 */
                const receivedAmountLamports = solToLamports(price * holdings);
                balanceLamports += receivedAmountLamports; // Sell all held tokens at current price
                holdings = 0;

                const sellPosition: SellPosition = {
                    timestamp: Date.now(),
                    amountRaw: holdings,
                    grossReceivedLamports: receivedAmountLamports,
                    netReceivedLamports: receivedAmountLamports,
                    price: {
                        inSol: price,
                        inLamports: solToLamports(price),
                    },
                    marketCap: marketCap,
                    reason: sell.reason,
                    metadata: {
                        pumpMinLamportsOutput: holdings,
                    },
                };

                const lastTradeHistoryEntry = tradeHistory[tradeHistory.length - 1];
                lastTradeHistoryEntry.sellPositions.push(sellPosition);
                const netPlnInLamports =
                    lastTradeHistoryEntry.buyPosition.netTransferredLamports + sellPosition.netReceivedLamports;
                lastTradeHistoryEntry.netPnl = {
                    inLamports: netPlnInLamports,
                    inSol: lamportsToSol(netPlnInLamports),
                };
                strategy.afterSell();
                if (onlyOneFullTrade) {
                    break;
                }
            }

            // Track peak balanceLamports for drawdown calculation
            const currentBalanceLamports = balanceLamports + holdings * price;
            if (currentBalanceLamports > peakBalanceLamports) {
                peakBalanceLamports = currentBalanceLamports;
            }

            const drawdown = (peakBalanceLamports - currentBalanceLamports) / peakBalanceLamports;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }

        let finalBalanceLamports = initialBalanceLamports;
        for (const trade of tradeHistory) {
            finalBalanceLamports += trade.netPnl.inLamports;
        }
        const profitLossLamports = finalBalanceLamports - initialBalanceLamports;

        return {
            tradeHistory: tradeHistory,
            finalBalanceLamports: finalBalanceLamports,
            profitLossLamports: profitLossLamports,
            holdings: holdings,
            roi: (profitLossLamports / initialBalanceLamports) * 100,
            maxDrawdown: maxDrawdown,
        };
    }
}
