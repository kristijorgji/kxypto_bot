import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import { PUMPFUN_TOKEN_DECIMALS } from '@src/blockchains/solana/dex/pumpfun/constants';
import { calculatePumpTokenLamportsValue } from '@src/blockchains/solana/dex/pumpfun/pump-base';
import {
    simulatePumpBuyLatencyMs,
    simulatePumpSellLatencyMs,
} from '@src/blockchains/solana/dex/pumpfun/pump-simulation';
import { PumpfunInitialCoinData } from '@src/blockchains/solana/dex/pumpfun/types';
import { JitoConfig, TIP_LAMPORTS } from '@src/blockchains/solana/Jito';
import {
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulateSolTransactionDetails,
    simulateSolanaPriorityFeeInLamports,
} from '@src/blockchains/solana/utils/simulations';
import { lamportsToSol, solToLamports } from '@src/blockchains/utils/amount';

import { formSolBoughtOrSold, formTokenBoughtOrSold } from './PumpfunBot';
import {
    BacktestMintResponse,
    BacktestStrategyRunConfig,
    HandlePumpTokenBotReport,
    PumpfunBuyPositionMetadata,
    PumpfunSellPositionMetadata,
    TradeTransaction,
} from './types';
import { HistoryEntry } from '../../launchpads/types';
import { BotEvent, SellReason, ShouldBuyResponse, ShouldSellResponse } from '../../types';

const BacktestWallet = '_backtest_';

export default class PumpfunBacktester {
    public static readonly DefaultStaticPriorityFeeInSol = 0.005;
    public static readonly PumpfunAccountCreationFeeLamports = 4045000;

    constructor(private readonly logger: Logger) {}

    async run(
        {
            initialBalanceLamports,
            buyAmountSol,
            jitoConfig,
            strategy,
            randomization,
            onlyOneFullTrade,
            sellUnclosedPositionsAtEnd,
            autoSellTimeoutMs,
        }: BacktestStrategyRunConfig,
        tokenInfo: PumpfunInitialCoinData,
        history: HistoryEntry[],
        monitorConfig: HandlePumpTokenBotReport['monitor'],
    ): Promise<BacktestMintResponse> {
        const historySoFar: HistoryEntry[] = [];
        let balanceLamports = initialBalanceLamports;
        let holdingsRaw = 0;
        let soldOnce = false;
        const tradeHistory: TradeTransaction[] = [];
        const events: BotEvent[] = [];
        let peakBalanceLamports = initialBalanceLamports; // Tracks the highest balanceLamports achieved
        let maxDrawdownPercentage = 0; // Tracks max drawdown from peak
        const buyAmountLamports = solToLamports(buyAmountSol);
        const jitoTipLamports = getJitoTipLamports(jitoConfig);

        let shouldSellRes: ShouldSellResponse | undefined;

        /**
         * Adjusts the loop's search increment based on buy events found in the recorded history.
         * Initially, the step size is 1 to represent a constant monitoring interval.
         * Once the backtest finds a buy event has occurred, the step size is adjusted to match the `sellMonitorMs`
         * value, simulating the bot's transition to a new monitoring period.
         * This ensures that backtests monitors with same ms interval if it hasn't bought yet so
         * its behavior is comparable with the one of the recorded history from a real bot
         */
        let stepSize = 1;

        for (let i = 0; i < history.length; i += stepSize) {
            let marketContext = history[i];
            if (marketContext.price === null) {
                this.logger.warn(`Skipping entry: marketContext.price = null at index ${i}`);
                continue;
            }

            let sellShouldCallContinue = false;

            historySoFar.push(marketContext);
            const { price, marketCap } = marketContext;

            if (marketContext._metadata?.action === 'buyCompleted') {
                if (monitorConfig.buyTimeframeMs % monitorConfig.sellTimeframeMs !== 0) {
                    throw new Error(
                        'monitorConfig.buyTimeframeMs must be a multiple of monitorConfig.sellTimeframeMs.',
                    );
                }

                stepSize = monitorConfig.buyTimeframeMs / monitorConfig.sellTimeframeMs;
            }

            /**
             * Check if we should buy when we have no active position
             */
            if (!strategy.buyPosition) {
                const buyPriorityFeeInSol =
                    strategy.config.buyPriorityFeeInSol ??
                    strategy.config.priorityFeeInSol ??
                    (randomization.priorityFees
                        ? lamportsToSol(simulateSolanaPriorityFeeInLamports())
                        : PumpfunBacktester.DefaultStaticPriorityFeeInSol);

                const simulatedBuyLatencyMs = simulatePumpBuyLatencyMs(
                    buyPriorityFeeInSol,
                    jitoConfig,
                    randomization.execution,
                );

                const { buyPrice, buyInLamports } = ((): {
                    buyPrice: number;
                    buyInLamports: number;
                } => {
                    if (randomization.slippages === 'randomized' || randomization.slippages === 'off') {
                        const slippageModifier =
                            randomization.slippages === 'randomized'
                                ? simulatePriceWithHigherSlippage(1, strategy.config.buySlippageDecimal)
                                : 1 + strategy.config.buySlippageDecimal;
                        return {
                            buyPrice: price * slippageModifier,
                            buyInLamports: buyAmountLamports * slippageModifier,
                        };
                    } else if (randomization.slippages === 'closestEntry') {
                        /**
                         * it will use either the previous or next history entry's price closest to the 25% of the simulation
                         * buy time (because usually within 25% of time request reaches the server,
                         * the rest of the buy function is validating, storing and fetching from the blockchain)
                         */
                        const buyPrice =
                            history[
                                getClosestEntryIndex(
                                    history,
                                    i,
                                    marketContext.timestamp + 0.25 * simulatedBuyLatencyMs,
                                    stepSize,
                                )
                            ].price;
                        const buyPriceDiffPercentageDecimal = (buyPrice - price) / price;
                        return {
                            buyPrice: buyPrice,
                            buyInLamports: buyAmountLamports * (1 + buyPriceDiffPercentageDecimal),
                        };
                    } else {
                        throw new Error(`Unknown randomization.slippages mode ${randomization.slippages} was provided`);
                    }
                })();
                // We create the associated pumpfun token account and pay its fee the first time we trade this token
                const pumpCreateAccountFeeLamports =
                    tradeHistory.length === 0 ? PumpfunBacktester.PumpfunAccountCreationFeeLamports : 0;
                const minBalanceToBuyLamports =
                    buyInLamports + solToLamports(buyPriorityFeeInSol) + pumpCreateAccountFeeLamports + jitoTipLamports;

                // no more money for further purchases, and also we have no position
                if (balanceLamports <= minBalanceToBuyLamports && !strategy.buyPosition) {
                    events.push({
                        historyRef: {
                            timestamp: marketContext.timestamp,
                            index: i,
                        },
                        action: 'strategyExit',
                        reason: 'no_funds_to_buy',
                    });
                    break;
                }

                let shouldBuyRes: ShouldBuyResponse | undefined;
                if (balanceLamports >= minBalanceToBuyLamports && !strategy.buyPosition) {
                    shouldBuyRes = await strategy.shouldBuy(
                        tokenInfo.mint,
                        {
                            timestamp: marketContext.timestamp,
                            index: i,
                        },
                        marketContext,
                        historySoFar,
                    );
                }
                if (shouldBuyRes?.buy === true) {
                    events.push({
                        historyRef: {
                            timestamp: marketContext.timestamp,
                            index: i,
                        },
                        action: 'startBuy',
                        reason: shouldBuyRes.reason,
                    });

                    const txDetails = simulateSolTransactionDetails(
                        -buyInLamports - pumpCreateAccountFeeLamports - jitoTipLamports,
                        solToLamports(buyPriorityFeeInSol),
                    );

                    holdingsRaw += calculateRawTokenHoldings(buyAmountSol, price);
                    balanceLamports += txDetails.netTransferredLamports;

                    const buyPosition: TradeTransaction<PumpfunBuyPositionMetadata> = {
                        timestamp: Date.now(),
                        transactionType: 'buy',
                        subCategory: tradeHistory.find(e => e.transactionType === 'buy')
                            ? 'accumulation'
                            : 'newPosition',
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
                        metadata: {
                            historyRef: {
                                timestamp: marketContext.timestamp,
                                index: i,
                            },
                            historyEntry: marketContext,
                            pumpInSol: lamportsToSol(buyInLamports),
                            pumpMaxSolCost: lamportsToSol(buyInLamports),
                            pumpTokenOut: holdingsRaw,
                            pumpBuyPriceInSol: buyPrice,
                            buyRes: {
                                reason: shouldBuyRes.reason,
                                ...(shouldBuyRes.data ? { data: shouldBuyRes.data } : {}),
                            },
                        },
                    };
                    tradeHistory.push(buyPosition);
                    strategy.afterBuy(price, {
                        marketContext: marketContext,
                        transaction: buyPosition,
                    });

                    let shouldCallContinue = false;
                    if (i < history.length - 1) {
                        // Simulate time passing by going to the next market context
                        i = getNextEntryIndex(history, i, marketContext.timestamp + simulatedBuyLatencyMs, stepSize);
                        marketContext = history[i];
                        shouldCallContinue = true;
                    }

                    events.push({
                        historyRef: {
                            timestamp: marketContext.timestamp,
                            index: i,
                        },
                        action: 'buyCompleted',
                    });

                    if (shouldCallContinue) {
                        i -= stepSize;
                        continue;
                    }
                }
            }

            /**
             * Check if strategy wants to exit if we are not holding any unsold position
             */
            if (!strategy.buyPosition) {
                const shouldExitRes = strategy.shouldExit(marketContext, historySoFar, {
                    elapsedMonitoringMs: marketContext.timestamp - history[0].timestamp,
                });
                if (shouldExitRes) {
                    if (shouldExitRes.shouldSell) {
                        shouldSellRes = {
                            sell: true,
                            reason: shouldExitRes.shouldSell.reason,
                        };
                    } else {
                        return {
                            historyRef: {
                                timestamp: marketContext.timestamp,
                                index: i,
                            },
                            exitCode: shouldExitRes.exitCode,
                            exitReason: shouldExitRes.message,
                        };
                    }
                }
            }

            /**
             * Check if sell criteria are met for the held position
             * strategy.shouldSell has priority over strategy.shouldExit in case it requires sell
             */
            if (strategy.buyPosition) {
                const strategyShouldSellRes = await strategy.shouldSell(
                    tokenInfo.mint,
                    {
                        timestamp: marketContext.timestamp,
                        index: i,
                    },
                    marketContext,
                    historySoFar,
                );
                if (strategyShouldSellRes.sell) {
                    shouldSellRes = {
                        sell: true,
                        reason: strategyShouldSellRes.reason,
                    };
                } else if (autoSellTimeoutMs) {
                    const elapsedSinceBuyMs =
                        marketContext.timestamp - strategy.buyPosition.transaction.metadata!.historyRef.timestamp;
                    if (elapsedSinceBuyMs >= autoSellTimeoutMs) {
                        this.logger.info(
                            'Auto-sell triggered because elapsed time (%sms) exceeded timeout (%sms)',
                            elapsedSinceBuyMs,
                            autoSellTimeoutMs,
                        );
                        shouldSellRes = {
                            sell: true,
                            reason: 'AUTO_SELL_TIMEOUT',
                        };
                    }
                }
                if (!shouldSellRes && sellUnclosedPositionsAtEnd && i === history.length - 1) {
                    shouldSellRes = {
                        sell: true,
                        reason: 'BEFORE_EXIT_MONITORING',
                    };
                }
            }

            /**
             * Execute sell simulation when we have a position, holdings and a reason to sell
             */
            if (shouldSellRes?.sell && strategy.buyPosition && holdingsRaw > 0) {
                events.push({
                    historyRef: {
                        timestamp: marketContext.timestamp,
                        index: i,
                    },
                    action: 'startSell',
                    reason: shouldSellRes.reason,
                });

                const sellPriorityFeeInSol =
                    strategy.config.sellPriorityFeeInSol ??
                    strategy.config.priorityFeeInSol ??
                    (randomization.priorityFees
                        ? lamportsToSol(simulateSolanaPriorityFeeInLamports())
                        : PumpfunBacktester.DefaultStaticPriorityFeeInSol);

                const simulatedSellLatencyMs = simulatePumpSellLatencyMs(
                    sellPriorityFeeInSol,
                    jitoConfig,
                    randomization.execution,
                );

                const { sellPrice, receivedAmountLamports } = ((): {
                    sellPrice: number;
                    receivedAmountLamports: number;
                } => {
                    if (randomization.slippages === 'off' || randomization.slippages === 'randomized') {
                        const slippageModifier =
                            randomization.slippages === 'randomized'
                                ? simulatePriceWithLowerSlippage(1, strategy.config.sellSlippageDecimal)
                                : 1 - strategy.config.sellSlippageDecimal;
                        return {
                            sellPrice: price * slippageModifier,
                            receivedAmountLamports:
                                calculatePumpTokenLamportsValue(holdingsRaw, price) * slippageModifier,
                        };
                    } else if (randomization.slippages === 'closestEntry') {
                        /**
                         * it will use either the previous or next history entry's price closest to the 25% of the simulation
                         * sell time (because usually within 25% of time request reaches the server,
                         * the rest of the sell function is validating, storing and fetching from the blockchain)
                         */
                        const sellPrice =
                            history[
                                getClosestEntryIndex(
                                    history,
                                    i,
                                    marketContext.timestamp + 0.25 * simulatedSellLatencyMs,
                                    stepSize,
                                )
                            ].price;
                        const sellPriceDiffPercentageDecimal = (sellPrice - price) / price;
                        return {
                            sellPrice: sellPrice,
                            receivedAmountLamports:
                                calculatePumpTokenLamportsValue(holdingsRaw, price) *
                                (1 + sellPriceDiffPercentageDecimal),
                        };
                    } else {
                        throw new Error(`Unknown randomization.slippages mode ${randomization.slippages} was provided`);
                    }
                })();

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
                        historyRef: {
                            timestamp: marketContext.timestamp,
                            index: i,
                        },
                        historyEntry: marketContext,
                        reason: shouldSellRes.reason as SellReason,
                        pumpMinLamportsOutput: holdingsRaw,
                        sellPriceInSol: sellPrice,
                        sellRes: {
                            reason: shouldSellRes.reason,
                            ...(shouldSellRes.data ? { data: shouldSellRes.data } : {}),
                        },
                    },
                } satisfies TradeTransaction<PumpfunSellPositionMetadata>);

                balanceLamports += txDetails.netTransferredLamports;
                holdingsRaw = 0;

                shouldSellRes = undefined;
                strategy.afterSell();

                sellShouldCallContinue = false;
                if (i < history.length - 1) {
                    // Simulate time passing by going to the next market context
                    i = getNextEntryIndex(history, i, marketContext.timestamp + simulatedSellLatencyMs, stepSize);
                    marketContext = history[i];
                    sellShouldCallContinue = true;
                }

                events.push({
                    historyRef: {
                        timestamp: marketContext.timestamp,
                        index: i,
                    },
                    action: 'sellCompleted',
                });
                soldOnce = true;
            }

            // Track peak balanceLamports for drawdownPercentage calculation
            const currentBalanceLamports = balanceLamports + calculatePumpTokenLamportsValue(holdingsRaw, price);
            if (currentBalanceLamports > peakBalanceLamports) {
                peakBalanceLamports = currentBalanceLamports;
            }

            const drawdownPercentage = ((peakBalanceLamports - currentBalanceLamports) / peakBalanceLamports) * 100;
            maxDrawdownPercentage = Math.max(maxDrawdownPercentage, drawdownPercentage);

            if (soldOnce && onlyOneFullTrade) {
                break;
            }

            if (sellShouldCallContinue) {
                i -= stepSize;
            }
        }

        const profitLossLamports = balanceLamports - initialBalanceLamports;

        return {
            tradeHistory: tradeHistory,
            events: events,
            finalBalanceLamports: balanceLamports,
            profitLossLamports: profitLossLamports,
            holdings: {
                amountRaw: holdingsRaw,
                lamportsValue: calculatePumpTokenLamportsValue(holdingsRaw, history[history.length - 1].price),
            },
            roi: (profitLossLamports / initialBalanceLamports) * 100,
            maxDrawdownPercentage: maxDrawdownPercentage,
        };
    }
}

export function getNextEntryIndex(
    history: HistoryEntry[],
    currentIndex: number,
    nextTimestampMs: number,
    stepSize: number,
): number {
    for (let j = currentIndex; j < history.length; j += stepSize) {
        if (history[j].timestamp >= nextTimestampMs) {
            return j;
        }
    }

    return history.length - 1;
}

export function getClosestEntryIndex(
    history: HistoryEntry[],
    currentIndex: number,
    nextTimestampMs: number,
    stepSize: number,
): number {
    const nextIndex = currentIndex < history.length - stepSize ? currentIndex + stepSize : currentIndex;

    if (nextTimestampMs - history[currentIndex].timestamp < history[nextIndex].timestamp - nextTimestampMs) {
        return currentIndex;
    }

    return getNextEntryIndex(history, currentIndex, nextTimestampMs, stepSize);
}

function _generateFakeBacktestTransactionHash() {
    return `_backtest_${uuidv4()}`;
}

export function getJitoTipLamports(jitoConfig?: JitoConfig): number {
    return jitoConfig?.jitoEnabled ? (jitoConfig.tipLamports ?? TIP_LAMPORTS) : 0;
}

function calculateRawTokenHoldings(amountSol: number, priceSol: number): number {
    return (amountSol / priceSol) * 10 ** PUMPFUN_TOKEN_DECIMALS;
}
