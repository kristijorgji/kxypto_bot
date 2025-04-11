import { Logger } from 'winston';

import { formSolBoughtOrSold, formTokenBoughtOrSold } from './PumpfunBot';
import { BacktestExitResponse, BacktestRunConfig, BacktestTradeResponse, TradeTransaction } from './types';
import { PUMPFUN_TOKEN_DECIMALS } from '../../../../blockchains/solana/dex/pumpfun/constants';
import {
    simulatePumpBuyLatencyMs,
    simulatePumpSellLatencyMs,
} from '../../../../blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../blockchains/solana/dex/pumpfun/types';
import { calculatePumpTokenLamportsValue } from '../../../../blockchains/solana/dex/pumpfun/utils';
import { JitoConfig, TIP_LAMPORTS } from '../../../../blockchains/solana/Jito';
import {
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulateSolTransactionDetails,
    simulateSolanaPriorityFeeInLamports,
} from '../../../../blockchains/solana/utils/simulations';
import { lamportsToSol, solToLamports } from '../../../../blockchains/utils/amount';
import { HistoryEntry } from '../../launchpads/types';
import { SellReason } from '../../types';

const BacktestWallet = '_backtest_';

export default class PumpfunBacktester {
    public static readonly DefaultStaticPriorityFeeInSol = 0.005;
    public static readonly PumpfunAccountCreationFeeLamports = 4045000;

    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly logger: Logger) {}

    async run(
        {
            initialBalanceLamports,
            buyAmountSol,
            jitoConfig,
            strategy,
            useRandomizedValues,
            onlyOneFullTrade,
            sellUnclosedPositionsAtEnd,
        }: BacktestRunConfig,
        tokenInfo: PumpfunInitialCoinData,
        history: HistoryEntry[],
    ): Promise<BacktestTradeResponse | BacktestExitResponse> {
        const historySoFar: HistoryEntry[] = [];
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

        for (let i = 0; i < history.length; i++) {
            const marketContext = history[i];
            historySoFar.push(marketContext);
            const { price, marketCap } = marketContext;

            const buyInLamports = useRandomizedValues
                ? simulatePriceWithHigherSlippage(buyAmountLamports, strategy.config.buySlippageDecimal)
                : buyAmountLamports * (1 + strategy.config.buySlippageDecimal);
            const buyPriorityFeeInSol =
                strategy.config.buyPriorityFeeInSol ??
                strategy.config.priorityFeeInSol ??
                (useRandomizedValues
                    ? lamportsToSol(simulateSolanaPriorityFeeInLamports())
                    : PumpfunBacktester.DefaultStaticPriorityFeeInSol);

            // We create the associated pumpfun token account and pay its fee the first time we trade this token
            const pumpCreateAccountFeeLamports =
                tradeHistory.length === 0 ? PumpfunBacktester.PumpfunAccountCreationFeeLamports : 0;
            const jitoTipLamports = getJitoTipLamports(jitoConfig);
            const requiredAmountLamports =
                buyInLamports + solToLamports(buyPriorityFeeInSol) + pumpCreateAccountFeeLamports + jitoTipLamports;

            // no more money for further purchases, and also we have no position
            if (balanceLamports < requiredAmountLamports && !strategy.buyPosition) {
                break;
            }

            if (
                balanceLamports > requiredAmountLamports &&
                !strategy.buyPosition &&
                (await strategy.shouldBuy(tokenInfo.mint, marketContext, historySoFar))
            ) {
                const txDetails = simulateSolTransactionDetails(
                    -buyInLamports - pumpCreateAccountFeeLamports - jitoTipLamports,
                    solToLamports(buyPriorityFeeInSol),
                );

                holdingsRaw += (buyAmountSol / price) * 10 ** PUMPFUN_TOKEN_DECIMALS;
                balanceLamports += txDetails.netTransferredLamports;

                const buyPosition: TradeTransaction = {
                    timestamp: Date.now(),
                    transactionType: 'buy',
                    subCategory: tradeHistory.find(e => e.transactionType === 'buy') ? 'accumulation' : 'newPosition',
                    transactionHash: _generateFakeBacktestTransactionHash(),
                    walletAddress: BacktestWallet,
                    bought: formTokenBoughtOrSold(tokenInfo, holdingsRaw),
                    sold: formSolBoughtOrSold(txDetails.grossTransferredLamports),
                    amountRaw: holdingsRaw,
                    grossTransferredLamports: txDetails.grossTransferredLamports,
                    netTransferredLamports: txDetails.netTransferredLamports,
                    price: {
                        inLamports: solToLamports(price),
                        inSol: price,
                    },
                    marketCap: marketCap,
                };
                tradeHistory.push(buyPosition);
                strategy.afterBuy(price, {
                    marketContext: marketContext,
                    transaction: buyPosition,
                });

                if (i < history.length - 1) {
                    // Simulate time passing by going to the next market context
                    i =
                        getNextEntryIndex(
                            history,
                            i,
                            marketContext.timestamp +
                                simulatePumpBuyLatencyMs(buyPriorityFeeInSol, jitoConfig, useRandomizedValues),
                        ) - 1;
                    continue;
                }
            }

            if (!strategy.buyPosition) {
                const shouldExitRes = strategy.shouldExit(marketContext, historySoFar, {
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
                const shouldSellRes = await strategy.shouldSell(tokenInfo.mint, marketContext, historySoFar);
                if (shouldSellRes !== false) {
                    sell = {
                        reason: shouldSellRes.reason,
                    };
                } else if (sellUnclosedPositionsAtEnd && i === history.length - 1) {
                    sell = {
                        reason: 'BEFORE_EXIT_MONITORING',
                    };
                }
            }

            if (sell && strategy.buyPosition && holdingsRaw > 0) {
                const receivedAmountLamports = useRandomizedValues
                    ? simulatePriceWithLowerSlippage(
                          calculatePumpTokenLamportsValue(holdingsRaw, price),
                          strategy.config.sellSlippageDecimal,
                      )
                    : calculatePumpTokenLamportsValue(holdingsRaw, price) * (1 - strategy.config.sellSlippageDecimal);
                const sellPriorityFeeInSol =
                    strategy.config.sellPriorityFeeInSol ??
                    strategy.config.priorityFeeInSol ??
                    (useRandomizedValues
                        ? lamportsToSol(simulateSolanaPriorityFeeInLamports())
                        : PumpfunBacktester.DefaultStaticPriorityFeeInSol);
                const txDetails = simulateSolTransactionDetails(
                    receivedAmountLamports - jitoTipLamports,
                    solToLamports(sellPriorityFeeInSol),
                );

                tradeHistory.push({
                    timestamp: Date.now(),
                    transactionType: 'sell',
                    subCategory: 'sellAll',
                    transactionHash: _generateFakeBacktestTransactionHash(),
                    walletAddress: BacktestWallet,
                    bought: formSolBoughtOrSold(txDetails.grossTransferredLamports),
                    sold: formTokenBoughtOrSold(tokenInfo, holdingsRaw),
                    amountRaw: holdingsRaw,
                    grossTransferredLamports: txDetails.grossTransferredLamports,
                    netTransferredLamports: txDetails.netTransferredLamports,
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

                balanceLamports += txDetails.netTransferredLamports;
                holdingsRaw = 0;

                sell = undefined;
                strategy.afterSell();
                if (onlyOneFullTrade) {
                    break;
                }

                if (i < history.length - 1) {
                    // Simulate time passing by going to the next market context
                    i =
                        getNextEntryIndex(
                            history,
                            i,
                            marketContext.timestamp +
                                simulatePumpSellLatencyMs(sellPriorityFeeInSol, jitoConfig, useRandomizedValues),
                        ) - 1;
                    continue;
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

export function getNextEntryIndex(history: HistoryEntry[], currentIndex: number, nextTimestampMs: number): number {
    for (let j = currentIndex; j < history.length; j++) {
        if (history[j].timestamp >= nextTimestampMs) {
            return j;
        }
    }

    return history.length - 1;
}

function _generateFakeBacktestTransactionHash() {
    return `_backtest_${Date.now()}`;
}

export function getJitoTipLamports(jitoConfig?: JitoConfig): number {
    return jitoConfig?.jitoEnabled ? jitoConfig.tipLamports ?? TIP_LAMPORTS : 0;
}
