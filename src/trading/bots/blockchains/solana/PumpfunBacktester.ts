import { Logger } from 'winston';

import { BacktestExitResponse, BacktestRunConfig, BacktestTradeResponse, TradeTransaction } from './types';
import { PUMPFUN_TOKEN_DECIMALS } from '../../../../blockchains/solana/dex/pumpfun/constants';
import { PumpfunInitialCoinData } from '../../../../blockchains/solana/dex/pumpfun/types';
import { calculatePumpTokenLamportsValue } from '../../../../blockchains/solana/dex/pumpfun/utils';
import { solToLamports } from '../../../../blockchains/utils/amount';
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
        let holdingsRaw = 0;
        const tradeHistory: TradeTransaction[] = [];
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
                holdingsRaw += (buyAmountSol / price) * 10 ** PUMPFUN_TOKEN_DECIMALS;
                balanceLamports -= buyAmountLamports;

                const buyPosition: TradeTransaction = {
                    timestamp: Date.now(),
                    transactionType: 'buy',
                    subCategory: tradeHistory.find(e => e.transactionType === 'buy') ? 'newPosition' : 'accumulation',
                    transactionHash: Date.now().toString(),
                    amountRaw: holdingsRaw,
                    grossTransferredLamports: -buyAmountLamports,
                    netTransferredLamports: -buyAmountLamports,
                    price: {
                        inLamports: solToLamports(price),
                        inSol: price,
                    },
                    marketCap: marketCap,
                };
                tradeHistory.push(buyPosition);
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
                const receivedAmountLamports = calculatePumpTokenLamportsValue(holdingsRaw, price);
                balanceLamports += receivedAmountLamports; // Sell all held tokens at current price
                holdingsRaw = 0;

                tradeHistory.push({
                    timestamp: Date.now(),
                    transactionType: 'sell',
                    subCategory: 'sellAll',
                    transactionHash: Date.now().toString(),
                    amountRaw: holdingsRaw,
                    grossTransferredLamports: receivedAmountLamports,
                    netTransferredLamports: receivedAmountLamports,
                    price: {
                        inSol: price,
                        inLamports: solToLamports(price),
                    },
                    marketCap: marketCap,
                    metadata: {
                        reason: sell.reason,
                        pumpMinLamportsOutput: holdingsRaw,
                    },
                });

                strategy.afterSell();
                if (onlyOneFullTrade) {
                    break;
                }
            }

            // Track peak balanceLamports for drawdown calculation
            const currentBalanceLamports = balanceLamports + calculatePumpTokenLamportsValue(holdingsRaw, price);
            if (currentBalanceLamports > peakBalanceLamports) {
                peakBalanceLamports = currentBalanceLamports;
            }

            const drawdown = (peakBalanceLamports - currentBalanceLamports) / peakBalanceLamports;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }

        let finalBalanceLamports = initialBalanceLamports;
        for (const trade of tradeHistory) {
            finalBalanceLamports += trade.netTransferredLamports;
        }
        const profitLossLamports = finalBalanceLamports - initialBalanceLamports;

        return {
            tradeHistory: tradeHistory,
            finalBalanceLamports: finalBalanceLamports,
            profitLossLamports: profitLossLamports,
            holdings: {
                amountRaw: holdingsRaw,
                lamportsValue: calculatePumpTokenLamportsValue(holdingsRaw, history[history.length - 1].price),
            },
            roi: (profitLossLamports / initialBalanceLamports) * 100,
            maxDrawdown: maxDrawdown,
        };
    }
}
