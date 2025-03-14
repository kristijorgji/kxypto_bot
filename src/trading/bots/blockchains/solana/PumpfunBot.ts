import { Logger } from 'winston';

import PumpfunBotEventBus from './PumpfunBotEventBus';
import {
    BotExitResponse,
    BotResponse,
    BotTradeResponse,
    BoughtSold,
    PumpfunBuyPositionMetadata,
    PumpfunSellPositionMetadata,
    TradeTransaction,
} from './types';
import { measureExecutionTime } from '../../../../apm/apm';
import { SolanaTokenMints } from '../../../../blockchains/solana/constants/SolanaTokenMints';
import Pumpfun from '../../../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../../../blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import { PumpfunInitialCoinData } from '../../../../blockchains/solana/dex/pumpfun/types';
import {
    calculatePumpTokenLamportsValue,
    sellPumpfunTokensWithRetries,
} from '../../../../blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../../../../blockchains/solana/SolanaAdapter';
import { TransactionMode } from '../../../../blockchains/solana/types';
import Wallet from '../../../../blockchains/solana/Wallet';
import { lamportsToSol, solToLamports } from '../../../../blockchains/utils/amount';
import { closePosition, insertPosition } from '../../../../db/repositories/positions';
import { InsertPosition } from '../../../../db/types';
import { sleep } from '../../../../utils/functions';
import LaunchpadBotStrategy from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { generateTradeId } from '../../../utils/generateTradeId';
import { HistoryEntry } from '../../launchpads/types';
import { BotConfig, SellReason } from '../../types';

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

        this.botEventBus.onStopBot(() => this.stopBot());
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

        let sleepIntervalMs = this.config.buyMonitorWaitPeriodMs; // sleep interval between fetching new stats, price, holders etc. We can keep it higher before buying to save RPC calls and reduce when want to sell and monitor faster
        const startTimestamp = Date.now();
        let intervalsMonitoredAfterResult = 0;
        let initialMarketCap = -1;

        let buy = false;
        let buyInProgress = false;
        let position: InsertPosition | undefined;
        let sell:
            | {
                  reason: SellReason;
              }
            | undefined;
        let sellInProgress = false;
        const history: HistoryEntry[] = [];
        let result: BotResponse | undefined;

        while (this.isRunning || strategy.buyPosition || sellInProgress || buyInProgress) {
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
            } = marketContext;

            history.push({
                timestamp: Date.now(),
                price: priceInSol,
                marketCap: marketCapInSol,
                bondingCurveProgress: bondingCurveProgress,
                holdersCount: holdersCount,
                devHoldingPercentage: devHoldingPercentage,
                topTenHoldingPercentage: topTenHoldingPercentage,
            });

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
                'total holders=%d, top ten holding %s%%, dev holding %s%%',
                holdersCount,
                topTenHoldingPercentage,
                devHoldingPercentage,
            );
            logger.debug('Current vs initial market cap % difference: %s%%', mcDiffFromInitialPercentage);

            /**
             * Keep monitoring until max wait time after result is elapsed
             */
            if (result) {
                continue;
            }

            if (!actionInProgress && !strategy.buyPosition && strategy.shouldBuy(marketContext, history)) {
                logger.info('We set buy=true because the conditions are met');
                buy = true;
            }

            if (!actionInProgress) {
                const shouldExitRes = strategy.shouldExit(marketContext, history, {
                    elapsedMonitoringMs: elapsedMonitoringMs,
                });

                if (shouldExitRes) {
                    if (shouldExitRes.shouldSell) {
                        logger.info(shouldExitRes.message);
                        sell = {
                            reason: shouldExitRes.shouldSell.reason,
                        };
                    } else {
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

                logger.info('Price change since purchase %s%%', priceDiffPercentageSincePurchase);
                logger.info('Estimated sol diff %s', diffInSol);

                const shouldSellRes = strategy.shouldSell(marketContext, history);
                if (shouldSellRes !== false) {
                    sell = {
                        reason: shouldSellRes.reason,
                    };
                }
            }

            // eslint-disable-next-line no-unreachable
            if (!actionInProgress && !strategy.buyPosition && buy) {
                logger.info('We will start the buy buyInProgress=true');
                buyInProgress = true;
                history[history.length - 1]._metadata = {
                    action: 'startBuy',
                };

                const dataAtBuyTime = {
                    priceInSol: priceInSol,
                    marketCapInSol: marketCapInSol,
                    marketContext: marketContext,
                };
                // TODO calculate dynamically based on the situation if it is not provided
                const inSol = this.config.buyInSol ?? 0.4;
                const buyPriorityFeeInSol =
                    strategy.config.buyPriorityFeeInSol ?? strategy.config.priorityFeeInSol ?? DefaultPriorityFeeSol;
                measureExecutionTime(
                    () =>
                        this.pumpfun.buy({
                            transactionMode: this.config.simulate
                                ? TransactionMode.Simulation
                                : TransactionMode.Execution,
                            payerPrivateKey: this.wallet.privateKey,
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            solIn: inSol,
                            priorityFeeInSol: buyPriorityFeeInSol,
                            slippageDecimal: strategy.config.buySlippageDecimal,
                            jitoConfig: {
                                jitoEnabled: true,
                            },
                        }),
                    `pumpfun.buy_${buyPriorityFeeInSol}${this.config.simulate ? '_simulation' : ''}`,
                    { storeImmediately: true },
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
                                inSol: dataAtBuyTime.priceInSol,
                                inLamports: solToLamports(dataAtBuyTime.priceInSol),
                            },
                            marketCap: dataAtBuyTime.marketCapInSol,
                            metadata: {
                                pumpInSol: inSol,
                                pumpMaxSolCost: buyRes.pumpMaxSolCost,
                                pumpTokenOut: buyRes.pumpTokenOut,
                            },
                        };
                        this.botEventBus.tradeExecuted(buyPosition);
                        /**
                         * The longer the buy transaction takes the more likely price has changed, so need to put limit orders with most closely price to the one used to buy
                         * TODO calculate real buy price based on buyRes details and set up the limits accordingly
                         */
                        const limits = strategy.afterBuy(dataAtBuyTime.priceInSol, {
                            marketContext: dataAtBuyTime.marketContext,
                            transaction: buyPosition,
                        });
                        position = {
                            trade_id: generateTradeId('solana', tokenInfo.symbol),
                            chain: 'solana',
                            exchange: 'pumpfun',
                            user_address: this.wallet.address,
                            asset_mint: buyPosition.bought.address,
                            asset_symbol: buyPosition.bought.symbol,
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
                            inSol,
                            buyRes,
                        );

                        history[history.length - 1]._metadata = {
                            action: 'buyCompleted',
                        };
                        buyInProgress = false;
                    })
                    .catch(async e => {
                        // TODO handle properly and double check if it really failed or was block height transaction timeout
                        logger.error('Error while buying');
                        logger.error(e);

                        // TODO check the wallet if the buy was successful and timed out and proceed monitoring normally
                        // TODO make a proper sell only for this mint if we hold it and get back transaction details to store it into a tradehistory etc
                        const fallbackSell = async () =>
                            await sellPumpfunTokensWithRetries({
                                pumpfun: this.pumpfun,
                                wallet: this.wallet,
                                solanaAdapter: this.solanaAdapter,
                                mint: tokenMint,
                                retryConfig: {
                                    sleepMs: 150,
                                    maxRetries: 5,
                                },
                            });
                        logger.warn(
                            'Will sell the token immediately, and try to sell it again after 250ms to make sure is sold',
                        );
                        await fallbackSell();
                        await sleep(250);
                        logger.warn('Slept 250ms and will try to sell again to ensure any holdings is sold');
                        await fallbackSell();

                        buyInProgress = false;
                    });
            }

            if (!actionInProgress && sell && strategy.buyPosition) {
                logger.info('We will start the sell sellInProgress=true');
                sellInProgress = true;
                history[history.length - 1]._metadata = {
                    action: 'startSell',
                };

                const dataAtSellTime = {
                    buyPosition: strategy.buyPosition,
                    sellReason: sell.reason,
                    priceInSol: priceInSol,
                    marketCapInSol: marketCapInSol,
                };
                const sellPriorityFeeInSol =
                    strategy.config.sellPriorityFeeInSol ?? strategy.config.priorityFeeInSol ?? DefaultPriorityFeeSol;
                measureExecutionTime(
                    () =>
                        this.pumpfun.sell({
                            transactionMode: this.config.simulate
                                ? TransactionMode.Simulation
                                : TransactionMode.Execution,
                            payerPrivateKey: this.wallet.privateKey,
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            tokenBalance: strategy.buyPosition!.transaction.amountRaw,
                            priorityFeeInSol: sellPriorityFeeInSol,
                            slippageDecimal: strategy.config.sellSlippageDecimal,
                            jitoConfig: {
                                jitoEnabled: true,
                            },
                        }),
                    `pumpfun.sell_${sellPriorityFeeInSol}${this.config.simulate ? '_simulation' : ''}`,
                    { storeImmediately: true },
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
                                inSol: dataAtSellTime.priceInSol,
                                inLamports: solToLamports(dataAtSellTime.priceInSol),
                            },
                            marketCap: dataAtSellTime.marketCapInSol,
                            metadata: {
                                reason: dataAtSellTime.sellReason,
                                pumpMinLamportsOutput: sellRes.minLamportsOutput,
                            },
                        };
                        this.botEventBus.tradeExecuted(sellPosition);

                        const pnlLamports =
                            dataAtSellTime.buyPosition.transaction.netTransferredLamports +
                            sellPosition.netTransferredLamports;

                        closePosition(position!.trade_id, {
                            saleTxSignature: sellRes.signature,
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
                        this.botEventBus.botTradeResponse(result);

                        strategy.afterSell();
                        history[history.length - 1]._metadata = {
                            action: 'sellCompleted',
                        };
                    })
                    .catch(async e => {
                        // TODO handle errors, some error might be false negative example block height timeout, sell might be successful but we get error
                        logger.error('Error while selling');
                        logger.error(e);
                        throw e;
                    })
                    .finally(() => {
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
