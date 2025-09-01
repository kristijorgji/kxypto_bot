import { Logger } from 'winston';

import { measureExecutionTime } from '@src/apm/apm';
import { SolanaTokenMints } from '@src/blockchains/solana/constants/SolanaTokenMints';
import { calculatePumpTokenLamportsValue } from '@src/blockchains/solana/dex/pumpfun/pump-base';
import { PumpfunInitialCoinData, SolPumpfunTransactionDetails } from '@src/blockchains/solana/dex/pumpfun/types';
import { sellPumpfunTokensWithRetries } from '@src/blockchains/solana/dex/pumpfun/utils';
import { JitoConfig, TIP_LAMPORTS } from '@src/blockchains/solana/Jito';
import { TransactionMode } from '@src/blockchains/solana/types';
import { lamportsToSol, solToLamports } from '@src/blockchains/utils/amount';
import { closePosition, insertPosition } from '@src/db/repositories/positions';
import { InsertPosition } from '@src/db/types';
import { sleep } from '@src/utils/functions';

import PumpfunBotEventBus from './PumpfunBotEventBus';
import {
    BotExitResponse,
    BotResponse,
    BotTradeResponse,
    BoughtSold,
    HistoryRef,
    PumpfunBuyPositionMetadata,
    PumpfunSellPositionMetadata,
    TradeTransaction,
} from './types';
import Pumpfun from '../../../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../../../blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import SolanaAdapter from '../../../../blockchains/solana/SolanaAdapter';
import Wallet from '../../../../blockchains/solana/Wallet';
import LaunchpadBotStrategy from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { generateTradeId } from '../../../utils/generateTradeId';
import { HistoryEntry } from '../../launchpads/types';
import { BotConfig, SellReason, ShouldBuyResponse, ShouldSellResponse } from '../../types';

export const ErrorMessage = {
    unknownBuyError: 'unknown_buying_error',
    insufficientFundsToBuy: 'no_funds_to_buy',
    buySlippageMoreSolRequired: 'pumpfun_slippage_more_sol_required',
};

const DefaultPriorityFeeSol = 0.005;

export default class PumpfunBot {
    private readonly logger: Logger;
    private readonly pumpfun: Pumpfun;
    private readonly solanaAdapter: SolanaAdapter;
    private readonly marketContextProvider: PumpfunMarketContextProvider;
    private readonly wallet: Wallet;
    private readonly config: BotConfig;
    private readonly botEventBus: PumpfunBotEventBus;

    private identifier: string = '';
    private isRunning: boolean = false;

    constructor({
        logger,
        pumpfun,
        solanaAdapter,
        marketContextProvider,
        wallet,
        config,
        botEventBus,
    }: {
        logger: Logger;
        pumpfun: Pumpfun;
        solanaAdapter: SolanaAdapter;
        marketContextProvider: PumpfunMarketContextProvider;
        wallet: Wallet;
        config: BotConfig;
        botEventBus: PumpfunBotEventBus;
    }) {
        if (config.buyMonitorWaitPeriodMs % config.sellMonitorWaitPeriodMs !== 0) {
            throw new Error('buyMonitorWaitPeriodMs must be a multiple of sellMonitorWaitPeriodMs.');
        }

        this.logger = logger;
        this.pumpfun = pumpfun;
        this.solanaAdapter = solanaAdapter;
        this.marketContextProvider = marketContextProvider;
        this.wallet = wallet;
        this.config = config;
        this.botEventBus = botEventBus;

        this.botEventBus.onStopBot(({ excludeBotIds }) => {
            if (!excludeBotIds || !excludeBotIds.has(this.identifier)) {
                this.stopBot();
            } else {
                this.logger.info('[%s] Bot is ignoring stop event as its id is excluded', this.identifier);
            }
        });
    }

    /**
     * This function will handle a single buy and sell for the specified  pump token
     * or end without buying if no profitability is found
     */
    async run(
        listenerId: string,
        tokenInfo: PumpfunInitialCoinData,
        strategy: LaunchpadBotStrategy,
    ): Promise<BotResponse> {
        this.identifier = listenerId;
        const tokenMint = tokenInfo.mint;
        const logger = this.logger.child({
            contextMap: {
                listenerId: listenerId,
                tokenMint: tokenMint,
            },
        });

        if (this.isRunning) {
            throw new Error('Bot is already running!');
        }
        this.isRunning = true;

        const jitoConfig: JitoConfig = {
            jitoEnabled: true,
        };

        let sleepIntervalMs = this.config.buyMonitorWaitPeriodMs; // sleep interval between fetching new stats, price, holders etc. We can keep it higher before buying to save RPC calls and reduce when want to sell and monitor faster
        const startTimestamp = Date.now();
        let intervalsMonitoredAfterResult = 0;
        let initialMarketCap = -1;

        let shouldBuyRes: ShouldBuyResponse | undefined;
        let buyInProgress = false;
        let position: InsertPosition | undefined;
        let shouldSellRes: ShouldSellResponse | undefined;
        let sellInProgress = false;
        let historyIndex: number = 0;
        const history: HistoryEntry[] = [];
        let fatalError: Error | undefined;
        let result: BotResponse | undefined;

        const fallbackSellToken = async () => {
            const fn = () =>
                sellPumpfunTokensWithRetries({
                    pumpfun: this.pumpfun,
                    wallet: this.wallet,
                    solanaAdapter: this.solanaAdapter,
                    mint: tokenMint,
                    retryConfig: {
                        sleepMs: 150,
                        maxRetries: 5,
                    },
                });
            logger.warn('Token will be sold immediately, with a re-attempt in 250ms to ensure completion.');
            await fn();
            await sleep(250);
            logger.warn('Retrying sale attempt after 250ms delay to ensure all holdings are sold.');
            await fn();
        };

        /**
         * Keep monitoring even when bot is stopped isRunning=false as long as
         *  a buy or sell is still in progress
         *  we have a result and are monitoring until maxWaitMonitorAfterResultMs is met
         */
        while (this.isRunning || strategy.buyPosition || sellInProgress || buyInProgress || result) {
            if (fatalError) {
                throw fatalError;
            }

            const elapsedMonitoringMs = Date.now() - startTimestamp;
            const actionInProgress = buyInProgress || sellInProgress;

            const marketContext = await this.marketContextProvider.get({
                tokenMint: tokenMint,
                bondingCurve: tokenInfo.bondingCurve,
                creator: tokenInfo.creator,
            });
            const {
                price: priceInSol,
                marketCap: marketCapInSol,
                bondingCurveProgress,
                holdersCount,
                devHoldingPercentage,
                topTenHoldingPercentage,
                devHoldingPercentageCirculating,
                topTenHoldingPercentageCirculating,
                topHolderCirculatingPercentage,
            } = marketContext;

            const lastHistoryEntry: HistoryEntry = {
                timestamp: Date.now(),
                price: priceInSol,
                marketCap: marketCapInSol,
                bondingCurveProgress: bondingCurveProgress,
                holdersCount: holdersCount,
                devHoldingPercentage: devHoldingPercentage,
                topTenHoldingPercentage: topTenHoldingPercentage,
                devHoldingPercentageCirculating: devHoldingPercentageCirculating,
                topTenHoldingPercentageCirculating: topTenHoldingPercentageCirculating,
                topHolderCirculatingPercentage: topHolderCirculatingPercentage,
            };
            history.push(lastHistoryEntry);
            historyIndex++;
            const historyRef: HistoryRef = {
                timestamp: lastHistoryEntry.timestamp,
                index: historyIndex,
            };

            if (lastHistoryEntry.price === null) {
                this.logger.warn(`lastHistoryEntry.price = null at index ${historyIndex}`);
                if (!strategy.buyPosition && !buyInProgress) {
                    this.logger.warn('Skipping this entry');
                    continue;
                }
            }

            /**
             * We will continue to monitor for the specified period after are "done" with this particular token
             * either with exit without trade or with a trade done
             * These data will serve to further debug and backtest if our decision was correct or not
             */
            if (result) {
                const afterResultMonitorWaitPeriodMs = this.config.buyMonitorWaitPeriodMs;

                if (intervalsMonitoredAfterResult === 0) {
                    logger.info(
                        'We have the result already and are going to monitor %s seconds more',
                        this.config.maxWaitMonitorAfterResultMs / 1000,
                    );
                }

                if (
                    intervalsMonitoredAfterResult * afterResultMonitorWaitPeriodMs >=
                    this.config.maxWaitMonitorAfterResultMs
                ) {
                    this.logResult(logger, result);
                    strategy.resetState();
                    return result;
                }

                intervalsMonitoredAfterResult++;
                await sleep(afterResultMonitorWaitPeriodMs);
            }

            if (initialMarketCap === -1) {
                initialMarketCap = marketCapInSol;
            }

            const mcDiffFromInitialPercentage = ((marketCapInSol - initialMarketCap) / initialMarketCap) * 100;

            logger.debug(
                'price=%s, marketCap=%s, bondingCurveProgress=%s%%, entryTimestamp=%s',
                priceInSol,
                marketCapInSol,
                bondingCurveProgress,
                history[history.length - 1].timestamp,
            );
            logger.debug(
                'total holders=%d, top ten holding %s%%, dev holding %s%%, top ten circulating %s%%, dev holding circulating %s%%, top holder circulating %s%%',
                holdersCount,
                topTenHoldingPercentage,
                devHoldingPercentage,
                topTenHoldingPercentageCirculating,
                devHoldingPercentageCirculating,
                topHolderCirculatingPercentage,
            );
            logger.debug('Current vs initial market cap % difference: %s%%', mcDiffFromInitialPercentage);

            /**
             * Keep monitoring until max wait time after result is elapsed
             */
            if (result) {
                continue;
            }

            // TODO calculate dynamically based on the situation if it is not provided
            const buyInSol = this.config.buyInSol ?? 0.4;

            if (!actionInProgress && !strategy.buyPosition) {
                shouldBuyRes = await strategy.shouldBuy(tokenMint, historyRef, marketContext, history);
                if (shouldBuyRes.buy) {
                    logger.info('shouldBuyRes.buy=true because the strategy conditions are met');
                }
            }

            if (!actionInProgress) {
                const shouldExitRes = strategy.shouldExit(marketContext, history, {
                    elapsedMonitoringMs: elapsedMonitoringMs,
                });

                if (shouldExitRes) {
                    logger.info('strategy requires exit, res=%o', shouldExitRes);
                    if (shouldExitRes.shouldSell) {
                        shouldSellRes = {
                            sell: true,
                            reason: shouldExitRes.shouldSell.reason,
                        };
                    } else {
                        const lastHistoryIndex = history.length - 1;
                        history[lastHistoryIndex]._metadata = {
                            ...(history[lastHistoryIndex]._metadata ?? {}),
                            action: 'strategyExit',
                        };

                        result = {
                            exitCode: shouldExitRes.exitCode,
                            exitReason: shouldExitRes.message,
                            history: history,
                        };
                        continue;
                    }
                }
            }

            if (!actionInProgress && strategy.buyPosition) {
                const priceDiffPercentageSincePurchase =
                    ((solToLamports(priceInSol) - strategy.buyPosition.transaction.price.inLamports) /
                        strategy.buyPosition.transaction.price.inLamports) *
                    100;
                const diffInSol = lamportsToSol(
                    calculatePumpTokenLamportsValue(strategy.buyPosition.transaction.amountRaw, priceInSol) -
                        Math.abs(strategy.buyPosition.transaction.netTransferredLamports),
                );

                const lastHistoryIndex = history.length - 1;
                history[lastHistoryIndex]._metadata = {
                    ...(history[lastHistoryIndex]._metadata ?? {}),
                    diffSincePurchase: { percent: priceDiffPercentageSincePurchase, inSol: diffInSol },
                };

                logger.info('Price change since purchase %s%%', priceDiffPercentageSincePurchase);
                logger.info('Estimated sol diff %s', diffInSol);

                const strategyShouldSellRes = await strategy.shouldSell(tokenMint, historyRef, marketContext, history);
                if (strategyShouldSellRes.sell) {
                    shouldSellRes = strategyShouldSellRes;
                } else if (this.config.autoSellTimeoutMs) {
                    const elapsedSinceBuyMs = Date.now() - strategy.buyPosition.transaction.timestamp;

                    if (elapsedSinceBuyMs >= this.config.autoSellTimeoutMs) {
                        logger.info(
                            'Auto-sell triggered because elapsed time (%sms) exceeded timeout (%sms)',
                            elapsedSinceBuyMs,
                            this.config.autoSellTimeoutMs,
                        );
                        shouldSellRes = {
                            sell: true,
                            reason: 'AUTO_SELL_TIMEOUT',
                        };
                    }
                }
            }

            if (!actionInProgress && !strategy.buyPosition && shouldBuyRes?.buy) {
                logger.info('We will start the buy buyInProgress=true');
                buyInProgress = true;
                const lastHistoryIndex = history.length - 1;
                history[lastHistoryIndex]._metadata = {
                    ...(history[lastHistoryIndex]._metadata ?? {}),
                    action: 'startBuy',
                };

                const dataAtBuyTime = {
                    historyRef: {
                        timestamp: lastHistoryEntry.timestamp,
                        index: historyIndex,
                    },
                    historyEntry: lastHistoryEntry,
                    marketContext: marketContext,
                    shouldBuyRes: shouldBuyRes,
                };

                const buyPriorityFeeInSol =
                    strategy.config.buyPriorityFeeInSol ?? strategy.config.priorityFeeInSol ?? DefaultPriorityFeeSol;
                measureExecutionTime(
                    () =>
                        this.pumpfun.buy({
                            transactionMode: this.config.simulate
                                ? TransactionMode.Simulation
                                : TransactionMode.Execution,
                            wallet: this.wallet.toObject(),
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            solIn: buyInSol,
                            priorityFeeInSol: buyPriorityFeeInSol,
                            slippageDecimal: strategy.config.buySlippageDecimal,
                            jitoConfig: jitoConfig,
                        }),
                    formPumpfunApmTransactionName(this.config.simulate, 'buy', buyPriorityFeeInSol, jitoConfig),
                    { storeImmediately: true, provider: jitoConfig.jitoEnabled ? 'jito' : undefined },
                )
                    .then(buyRes => {
                        const buyPosition: TradeTransaction<PumpfunBuyPositionMetadata> = {
                            timestamp: Date.now(),
                            transactionType: 'buy',
                            subCategory: 'newPosition',
                            transactionHash: buyRes.signature,
                            walletAddress: this.wallet.address,
                            bought: formTokenBoughtOrSold(tokenInfo, buyRes.boughtAmountRaw),
                            sold: formSolBoughtOrSold(buyRes.txDetails.grossTransferredLamports),
                            amountRaw: buyRes.boughtAmountRaw,
                            grossTransferredLamports: buyRes.txDetails.grossTransferredLamports,
                            netTransferredLamports: buyRes.txDetails.netTransferredLamports,
                            price: {
                                inSol: buyRes.actualBuyPriceSol,
                                inLamports: solToLamports(buyRes.actualBuyPriceSol),
                            },
                            marketCap: dataAtBuyTime.marketContext.marketCap,
                            metadata: {
                                historyRef: dataAtBuyTime.historyRef,
                                historyEntry: dataAtBuyTime.historyEntry,
                                pumpInSol: buyInSol,
                                pumpMaxSolCost: buyRes.pumpMaxSolCost,
                                pumpTokenOut: buyRes.pumpTokenOut,
                                pumpBuyPriceInSol: buyRes.actualBuyPriceSol,
                                pumpMeta: buyRes.metadata,
                                buyRes: {
                                    reason: dataAtBuyTime.shouldBuyRes.reason,
                                    ...(dataAtBuyTime.shouldBuyRes.data
                                        ? { data: dataAtBuyTime.shouldBuyRes.data }
                                        : {}),
                                },
                            },
                        };

                        this.botEventBus.tradeExecuted(this.identifier, buyPosition);

                        const limits = strategy.afterBuy(buyRes.actualBuyPriceSol, {
                            marketContext: dataAtBuyTime.marketContext,
                            transaction: buyPosition,
                        });
                        position = {
                            mode: this.config.simulate ? 'simulation' : 'real',
                            trade_id: generateTradeId('solana', tokenInfo.symbol),
                            chain: 'solana',
                            exchange: 'pumpfun',
                            user_address: this.wallet.address,
                            asset_mint: buyPosition.bought.address,
                            asset_symbol: buyPosition.bought.symbol,
                            asset_name: buyPosition.bought.name,
                            entry_price: buyPosition.price.inSol,
                            in_amount: buyPosition.amountRaw,
                            stop_loss: limits.stopLoss ?? null,
                            trailing_sl_percent: limits.trailingStopLossPercentage ?? null,
                            take_profit: limits.takeProfit ?? null,
                            trailing_take_profit_percent: limits.trailingTakeProfit?.trailingProfitPercentage ?? null,
                            trailing_take_profit_stop_percent:
                                limits?.trailingTakeProfit?.trailingStopPercentage ?? null,
                            tx_signature: buyPosition.transactionHash,
                            status: 'open',
                            closed_at: null,
                            close_reason: null,
                            exit_tx_signature: null,
                            exit_price: null,
                            realized_profit: null,
                            exit_amount: null,
                        };
                        insertPosition(position).catch(reason => this.logger.error(reason));
                        sleepIntervalMs = this.config.sellMonitorWaitPeriodMs;

                        logger.info(
                            'Bought successfully %s amountRaw for %s sol. buyRes=%o',
                            buyRes!.boughtAmountRaw,
                            buyInSol,
                            buyRes,
                        );

                        const lastHistoryIndex = history.length - 1;
                        history[lastHistoryIndex]._metadata = {
                            ...(history[lastHistoryIndex]._metadata ?? {}),
                            action: 'buyCompleted',
                        };
                        shouldBuyRes = undefined;
                        buyInProgress = false;
                    })
                    .catch(async e => {
                        // TODO handle properly and double check if it really failed or was block height transaction timeout
                        logger.error('Error while buying, e=%o', e);
                        history[history.length - 1]._metadata = {
                            action: 'buyError',
                        };

                        fatalError = new Error(ErrorMessage.unknownBuyError);

                        if ((e as SolPumpfunTransactionDetails).error?.type === 'pumpfun_slippage_more_sol_required') {
                            fatalError = new Error(ErrorMessage.buySlippageMoreSolRequired);
                            const currentBalanceSol = lamportsToSol(await this.wallet.getBalanceLamports());
                            const buyInWithoutSlippage = buyInSol * (1 - strategy.config.buySlippageDecimal);
                            if (currentBalanceSol <= buyInWithoutSlippage) {
                                logger.error(
                                    'Current balance %s SOL is less than the required buyIn amount including slippage %s',
                                    currentBalanceSol,
                                    buyInWithoutSlippage,
                                );
                                fatalError = new Error(ErrorMessage.insufficientFundsToBuy);
                            } else {
                                return;
                            }
                        }

                        if ((e as SolPumpfunTransactionDetails).error?.type === 'insufficient_lamports') {
                            fatalError = new Error(ErrorMessage.insufficientFundsToBuy);
                        }

                        const failedToBuy =
                            fatalError && [ErrorMessage.insufficientFundsToBuy].includes(fatalError.message);
                        if (!failedToBuy) {
                            // TODO check the wallet if the buy was successful and timed out and proceed monitoring normally
                            // TODO make a proper sell only for this mint if we hold it and get back transaction details to store it into a tradehistory etc
                            await fallbackSellToken();
                        }

                        if (fatalError) {
                            shouldBuyRes = undefined;
                            buyInProgress = false;
                            return;
                        }
                    });
            }

            if (!actionInProgress && shouldSellRes?.sell && strategy.buyPosition) {
                logger.info('We will start the sell sellInProgress=true');
                sellInProgress = true;
                history[history.length - 1]._metadata = {
                    action: 'startSell',
                };

                const dataAtSellTime = {
                    buyPosition: strategy.buyPosition,
                    sellReason: shouldSellRes.reason as SellReason,
                    priceInSol: priceInSol,
                    marketCapInSol: marketCapInSol,
                    shouldSellRes: shouldSellRes,
                };
                const sellPriorityFeeInSol =
                    strategy.config.sellPriorityFeeInSol ?? strategy.config.priorityFeeInSol ?? DefaultPriorityFeeSol;
                measureExecutionTime(
                    () =>
                        this.pumpfun.sell({
                            transactionMode: this.config.simulate
                                ? TransactionMode.Simulation
                                : TransactionMode.Execution,
                            wallet: this.wallet.toObject(),
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            tokenBalance: strategy.buyPosition!.transaction.amountRaw,
                            priorityFeeInSol: sellPriorityFeeInSol,
                            slippageDecimal: strategy.config.sellSlippageDecimal,
                            jitoConfig: jitoConfig,
                        }),
                    formPumpfunApmTransactionName(this.config.simulate, 'sell', sellPriorityFeeInSol, jitoConfig),
                    { storeImmediately: true, provider: jitoConfig.jitoEnabled ? 'jito' : undefined },
                )
                    .then(sellRes => {
                        logger.info(
                            'We sold successfully %s amountRaw with reason %s and received net %s sol. sellRes=%o',
                            sellRes.soldRawAmount,
                            dataAtSellTime.sellReason,
                            lamportsToSol(sellRes.txDetails.netTransferredLamports),
                            sellRes,
                        );

                        const sellPosition: TradeTransaction<PumpfunSellPositionMetadata> = {
                            timestamp: Date.now(),
                            transactionType: 'sell',
                            subCategory: 'sellAll',
                            transactionHash: sellRes.signature,
                            walletAddress: this.wallet.address,
                            bought: formSolBoughtOrSold(sellRes.txDetails.grossTransferredLamports),
                            sold: formTokenBoughtOrSold(tokenInfo, sellRes.soldRawAmount),
                            amountRaw: sellRes.soldRawAmount,
                            grossTransferredLamports: sellRes.txDetails.grossTransferredLamports,
                            netTransferredLamports: sellRes.txDetails.netTransferredLamports,
                            price: {
                                inSol: sellRes.actualSellPriceSol,
                                inLamports: solToLamports(sellRes.actualSellPriceSol),
                            },
                            marketCap: dataAtSellTime.marketCapInSol,
                            metadata: {
                                historyRef: {
                                    timestamp: lastHistoryEntry.timestamp,
                                    index: historyIndex,
                                },
                                historyEntry: lastHistoryEntry,
                                reason: dataAtSellTime.sellReason,
                                pumpMinLamportsOutput: sellRes.minLamportsOutput,
                                sellPriceInSol: sellRes.actualSellPriceSol,
                                pumpMeta: sellRes.metadata,
                                sellRes: {
                                    reason: dataAtSellTime.shouldSellRes.reason,
                                    ...(dataAtSellTime.shouldSellRes.data
                                        ? { data: dataAtSellTime.shouldSellRes.data }
                                        : {}),
                                },
                            },
                        };
                        this.botEventBus.tradeExecuted(this.identifier, sellPosition);

                        const pnlLamports =
                            dataAtSellTime.buyPosition.transaction.netTransferredLamports +
                            sellPosition.netTransferredLamports;

                        closePosition(position!.trade_id, {
                            saleTxSignature: sellRes.signature,
                            closeReason: dataAtSellTime.sellReason,
                            exitPrice: sellPosition.price.inSol,
                            realizedProfit: lamportsToSol(pnlLamports),
                            exitAmount: sellPosition.amountRaw,
                        }).catch(this.logger.error);

                        result = {
                            netPnl: {
                                inLamports: pnlLamports,
                                inSol: lamportsToSol(pnlLamports),
                            },
                            transactions: [dataAtSellTime.buyPosition.transaction, sellPosition],
                            history: history,
                        };
                        this.botEventBus.botTradeResponse(this.identifier, result);

                        strategy.afterSell();
                        const lastHistoryIndex = history.length - 1;
                        history[lastHistoryIndex]._metadata = {
                            ...(history[lastHistoryIndex]._metadata ?? {}),
                            action: 'sellCompleted',
                        };
                    })
                    .catch(async e => {
                        // TODO handle errors, some error might be false negative example block height timeout, sell might be successful but we get error
                        logger.error('Error while selling');
                        logger.error((e as Error).message ? (e as Error).message : e);
                        history[history.length - 1]._metadata = {
                            action: 'sellError',
                        };

                        if ((e as SolPumpfunTransactionDetails).error?.object) {
                            const errorObj = (e as SolPumpfunTransactionDetails).error?.object as {
                                InstructionError?: (number | string)[];
                            };
                            if (errorObj.InstructionError) {
                                if (
                                    errorObj.InstructionError.length === 2 &&
                                    errorObj.InstructionError[0] === 3 &&
                                    errorObj.InstructionError[1] === 'IllegalOwner'
                                ) {
                                    logger.error('Account creation failed: Token-associated account already exists.');
                                    logger.info('Retrying sale operation on next tick...');
                                }
                            }
                        }
                    })
                    .finally(() => {
                        shouldSellRes = undefined;
                        sellInProgress = false;
                    });
            }

            await sleep(sleepIntervalMs);
        }

        logger.info('Bot stopped - will return the current result');
        result = result ?? {
            exitCode: 'STOPPED',
            exitReason: 'The bot was requested to stop',
            history: history,
        };
        this.logResult(logger, result);

        return result;
    }

    stopBot() {
        this.logger.info('[%s] Bot is stopping...', this.identifier);
        this.isRunning = false;
    }

    private logResult(logger: Logger, result: BotResponse): void {
        logger.info(
            'Finished handling token - will return the result of type %s',
            (result as BotTradeResponse)?.transactions
                ? `BotTradeResponse, netPnl=${(result as BotTradeResponse).netPnl.inSol} SOL`
                : `BotExitResponse, exitCode=${(result as BotExitResponse).exitCode}`,
        );
    }
}

function formPumpfunApmTransactionName(
    simulate: boolean,
    type: 'buy' | 'sell',
    priorityFeeSol: number,
    jitoConfig: JitoConfig,
): string {
    return `pumpfun.${type}_${simulate ? 'simulation' : 'real'}_${priorityFeeSol}${
        jitoConfig.jitoEnabled ? `_jito_${lamportsToSol(jitoConfig.tipLamports ?? TIP_LAMPORTS)}` : ''
    }`;
}

export function formSolBoughtOrSold(amountLamports: number): BoughtSold {
    return {
        address: SolanaTokenMints.WSOL,
        name: 'SOL',
        symbol: 'SOL',
        amount: Math.abs(amountLamports),
    };
}

export function formTokenBoughtOrSold(tokenInfo: PumpfunInitialCoinData, amountRaw: number): BoughtSold {
    return {
        address: tokenInfo.mint,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        amount: amountRaw,
    };
}
