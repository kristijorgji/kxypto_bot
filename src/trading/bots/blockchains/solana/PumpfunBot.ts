import { Logger } from 'winston';

import {
    BotExitResponse,
    BotResponse,
    BotTradeResponse,
    PumpfunBuyPositionMetadata,
    PumpfunSellPositionMetadata,
    TradeTransaction,
} from './types';
import { measureExecutionTime } from '../../../../apm/apm';
import Pumpfun from '../../../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../../../blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import { PumpfunInitialCoinData } from '../../../../blockchains/solana/dex/pumpfun/types';
import {
    calculatePumpTokenLamportsValue,
    sellPumpfunTokensWithRetries,
} from '../../../../blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../../../../blockchains/solana/SolanaAdapter';
import { TransactionMode, WalletInfo } from '../../../../blockchains/solana/types';
import { lamportsToSol, solToLamports } from '../../../../blockchains/utils/amount';
import { sleep } from '../../../../utils/functions';
import LaunchpadBotStrategy from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { HistoryEntry } from '../../launchpads/types';
import { BotConfig, SellReason } from '../../types';

const DefaultPriorityFeeSol = 0.005;

export default class PumpfunBot {
    private readonly logger: Logger;
    private readonly pumpfun: Pumpfun;
    private readonly solanaAdapter: SolanaAdapter;
    private readonly marketContextProvider: PumpfunMarketContextProvider;
    private readonly walletInfo: WalletInfo;
    private readonly config: BotConfig;

    private inProgress: boolean = false;

    constructor({
        logger,
        pumpfun,
        solanaAdapter,
        marketContextProvider,
        walletInfo,
        config,
    }: {
        logger: Logger;
        pumpfun: Pumpfun;
        solanaAdapter: SolanaAdapter;
        marketContextProvider: PumpfunMarketContextProvider;
        walletInfo: WalletInfo;
        config: BotConfig;
    }) {
        this.logger = logger;
        this.pumpfun = pumpfun;
        this.solanaAdapter = solanaAdapter;
        this.marketContextProvider = marketContextProvider;
        this.walletInfo = walletInfo;
        this.config = config;
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
        const tokenMint = tokenInfo.mint;
        const logger = this.logger.child({
            contextMap: {
                listenerId: listenerId,
                tokenMint: tokenMint,
            },
        });

        if (this.inProgress) {
            throw new Error('Bot is already running!');
        }
        this.inProgress = true;

        let sleepIntervalMs = this.config.buyMonitorWaitPeriodMs; // sleep interval between fetching new stats, price, holders etc. We can keep it higher before buying to save RPC calls and reduce when want to sell and monitor faster
        const startTimestamp = Date.now();
        let intervalsMonitoredAfterResult = 0;
        let initialMarketCap = -1;

        let buy = false;
        let buyInProgress = false;
        let sell:
            | {
                  reason: SellReason;
              }
            | undefined;
        let sellInProgress = false;
        const history: HistoryEntry[] = [];
        let result: BotResponse | undefined;

        while (true) {
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
                _afterResult: result !== undefined,
            });

            /**
             * We will continue to monitor for the specified period after are "done" with this particular token
             * either with exit without trade or with a trade done
             * These data will serve to further debug and backtest if our decision was correct or not
             */
            if (result) {
                if (intervalsMonitoredAfterResult === 0) {
                    logger.info(
                        'We have the result already and are going to monitor %s seconds more',
                        this.config.buyMonitorWaitPeriodMs / 1000,
                    );
                }

                if (
                    intervalsMonitoredAfterResult * this.config.afterResultMonitorWaitPeriodMs >=
                    this.config.buyMonitorWaitPeriodMs
                ) {
                    logger.info(
                        'Finished handling token - will return the result of type %s',
                        (result as BotTradeResponse)?.transactions
                            ? `BotTradeResponse, netPnl=${(result as BotTradeResponse).netPnl.inSol} SOL`
                            : `BotExitResponse, exitCode=${(result as BotExitResponse).exitCode}`,
                    );
                    strategy.resetState();
                    return result;
                }

                intervalsMonitoredAfterResult++;
                await sleep(this.config.afterResultMonitorWaitPeriodMs);
            }

            if (initialMarketCap === -1) {
                initialMarketCap = marketCapInSol;
            }

            const mcDiffFromInitialPercentage = ((marketCapInSol - initialMarketCap) / initialMarketCap) * 100;

            logger.debug(
                'price=%s, marketCap=%s, bondingCurveProgress=%s%%',
                priceInSol,
                marketCapInSol,
                bondingCurveProgress,
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
                    ((solToLamports(priceInSol) - strategy.buyPosition.price.inLamports) /
                        strategy.buyPosition.price.inLamports) *
                    100;
                const diffInSol = lamportsToSol(
                    calculatePumpTokenLamportsValue(strategy.buyPosition.amountRaw, priceInSol) -
                        Math.abs(strategy.buyPosition.netTransferredLamports),
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

                const dataAtBuyTime = {
                    priceInSol: priceInSol,
                    marketCapInSol: marketCapInSol,
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
                            payerPrivateKey: this.walletInfo.privateKey,
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            solIn: inSol,
                            priorityFeeInSol: buyPriorityFeeInSol,
                            slippageDecimal: strategy.config.buySlippageDecimal,
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
                        /**
                         * The longer the buy transaction takes the more likely price has changed, so need to put limit orders with most closely price to the one used to buy
                         * TODO calculate real buy price based on buyRes details and set up the limits accordingly
                         */
                        strategy.afterBuy(dataAtBuyTime.priceInSol, buyPosition);
                        sleepIntervalMs = this.config.sellMonitorWaitPeriodMs;

                        logger.info(
                            'Bought successfully %s amountRaw for %s sol. buyRes=%o',
                            buyRes!.boughtAmountRaw,
                            inSol,
                            buyRes,
                        );

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
                                walletInfo: this.walletInfo,
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
                            payerPrivateKey: this.walletInfo.privateKey,
                            tokenMint: tokenMint,
                            tokenBondingCurve: tokenInfo.bondingCurve,
                            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
                            tokenBalance: strategy.buyPosition!.amountRaw,
                            priorityFeeInSol: sellPriorityFeeInSol,
                            slippageDecimal: strategy.config.sellSlippageDecimal,
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

                        const pnlLamports =
                            dataAtSellTime.buyPosition.netTransferredLamports + sellPosition.netTransferredLamports;

                        result = {
                            netPnl: {
                                inLamports: pnlLamports,
                                inSol: lamportsToSol(pnlLamports),
                            },
                            transactions: [dataAtSellTime.buyPosition, sellPosition],
                            history: history,
                        };

                        strategy.afterSell();
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
    }
}
