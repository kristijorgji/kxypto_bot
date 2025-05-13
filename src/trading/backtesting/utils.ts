import fs from 'fs';

import { Logger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { forceGetPumpCoinInitialData } from '../../blockchains/solana/dex/pumpfun/utils';
import { lamportsToSol } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { pumpfunRepository } from '../../db/repositories/PumpfunRepository';
import { Tables } from '../../db/tables';
import { Backtest } from '../../db/types';
import { HandlePumpTokenBotReport } from '../../scripts/pumpfun/bot';
import { FileInfo } from '../../utils/files';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestExitResponse,
    BacktestRunConfig,
    BacktestTradeOrigin,
    BacktestTradeResponse,
    StrategyBacktestResult,
} from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

const cache: Record<string, HandlePumpTokenBotReport> = {};

export async function runStrategy(
    {
        backtester,
        pumpfun,
        logger,
    }: {
        backtester: PumpfunBacktester;
        pumpfun: Pumpfun;
        logger: Logger;
    },
    runConfig: BacktestRunConfig,
    files: FileInfo[],
    config?: {
        verbose?: boolean;
    },
): Promise<StrategyBacktestResult> {
    const verbose = config?.verbose ?? false;

    let processed = 0;
    const maxToProcess: number | null = null;

    let balanceLamports = runConfig.initialBalanceLamports;
    let totalProfitLossLamports = 0;
    let totalHoldingsValueInLamports = 0;
    let totalTradesCount = 0;
    let totalBuyTradesCount = 0;
    let totalSellTradesCount = 0;
    let winsCount = 0;
    let biggestWin: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: -1,
    };
    let lossesCount = 0;
    let biggestLoss: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: 1,
    };

    for (const file of files) {
        let content: HandlePumpTokenBotReport;
        if (cache[file.fullPath]) {
            content = cache[file.fullPath];
        } else {
            content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenBotReport;
            cache[file.fullPath] = content;
        }

        const initialCoinData = await forceGetPumpCoinInitialData(pumpfun, pumpfunRepository, content.mint);
        try {
            const r = await backtester.run(
                {
                    ...runConfig,
                    initialBalanceLamports: balanceLamports,
                },
                initialCoinData,
                content.history,
            );
            runConfig.strategy.resetState();

            if (verbose) {
                logger.info(
                    '[%d] Results for mint: %s, %s, %s',
                    processed,
                    initialCoinData.mint,
                    initialCoinData.name,
                    initialCoinData.symbol,
                );
            }

            if ((r as BacktestTradeResponse).tradeHistory) {
                const pr = r as BacktestTradeResponse;

                if (pr.tradeHistory.length > 0) {
                    totalProfitLossLamports += pr.profitLossLamports;
                    totalHoldingsValueInLamports += pr.holdings.lamportsValue;

                    totalTradesCount += pr.tradeHistory.length;
                    const buysTrades = pr.tradeHistory.filter(e => e.transactionType === 'buy').length;
                    totalBuyTradesCount += buysTrades;
                    totalSellTradesCount += pr.tradeHistory.length - buysTrades;

                    if (pr.profitLossLamports >= 0) {
                        winsCount++;
                        if (biggestWin.amountLamports < pr.profitLossLamports) {
                            biggestWin = {
                                mint: content.mint,
                                amountLamports: pr.profitLossLamports,
                            };
                        }
                    } else {
                        lossesCount++;
                        if (biggestLoss.amountLamports > pr.profitLossLamports) {
                            biggestLoss = {
                                mint: content.mint,
                                amountLamports: pr.profitLossLamports,
                            };
                        }
                    }

                    if (verbose) {
                        const isSingleFullTrade = runConfig.onlyOneFullTrade && pr.tradeHistory.length === 2;
                        logger.info(
                            'Final balance: %s SOL and holdings %s',
                            lamportsToSol(pr.finalBalanceLamports),
                            pr.holdings.amountRaw,
                        );
                        logger.info('Profit/Loss: %s SOL', lamportsToSol(pr.profitLossLamports));
                        logger.info(
                            'Holdings amount: %s, value: %s SOL',
                            pr.holdings.amountRaw,
                            lamportsToSol(pr.holdings.lamportsValue),
                        );
                        logger.info('Trades count %d', pr.tradeHistory.length);
                        logger.info('ROI %s%%', pr.roi);
                        logger.info('Max Drawdown: %s%%%s', pr.maxDrawdown, isSingleFullTrade ? '' : '\n');
                        if (isSingleFullTrade) {
                            logger.info(
                                'Trades=%o\n',
                                pr.tradeHistory.map(e => {
                                    const { historyRef, ...filteredMetadata } = e.metadata as Record<
                                        string,
                                        unknown
                                    > & { historyRef: BacktestTradeOrigin };

                                    return {
                                        timestamp: e.timestamp,
                                        transactionType: e.transactionType,
                                        subCategory: e.subCategory,
                                        historyRef: {
                                            ...historyRef,
                                            price: e.price,
                                            marketCap: e.marketCap,
                                        },
                                        grossTransferredLamports: e.grossTransferredLamports,
                                        netTransferredLamports: e.netTransferredLamports,
                                        amountRaw: e.amountRaw,
                                        metadata: filteredMetadata,
                                    };
                                }),
                            );
                        }
                    }
                } else {
                    if (verbose) {
                        logger.info(
                            '[%d] Completed full simulation — no trades executed across %d history entries\n',
                            processed,
                            content.history.length,
                        );
                    }
                }

                balanceLamports += pr.profitLossLamports;
                if (balanceLamports <= 0) {
                    logger.info(
                        '[%d] Stopping because reached <=0 balance: %s SOL',
                        processed,
                        lamportsToSol(balanceLamports),
                    );
                    break;
                }
            } else {
                const pr = r as BacktestExitResponse;
                if (verbose) {
                    logger.info(
                        '[%d] Exited monitoring with code: %s, reason: %s\n',
                        processed,
                        pr.exitCode,
                        pr.exitReason,
                    );
                }
            }
        } catch (e) {
            logger.error('[%d] Error handling mint %s', processed, initialCoinData.mint);
            logger.info(e);
        }

        processed++;

        if (processed === maxToProcess) {
            logger.info('[%d] Processed maxToProcess=%d files and will stop', processed, maxToProcess);
            break;
        }
    }

    return {
        totalPnlInSol: lamportsToSol(totalProfitLossLamports),
        finalBalanceLamports: balanceLamports,
        totalHoldingsValueInSol: lamportsToSol(totalHoldingsValueInLamports),
        totalRoi: (totalProfitLossLamports / runConfig.initialBalanceLamports) * 100,
        totalTradesCount: totalTradesCount,
        totalBuyTradesCount: totalBuyTradesCount,
        totalSellTradesCount: totalSellTradesCount,
        winRatePercentage: totalTradesCount === 0 ? 0 : (winsCount / (winsCount + lossesCount)) * 100,
        winsCount: winsCount,
        biggestWinPercentage:
            winsCount === 0 ? 0 : (lamportsToSol(biggestWin.amountLamports) / runConfig.buyAmountSol) * 100,
        lossesCount: lossesCount,
        biggestLossPercentage:
            lossesCount === 0 ? 0 : (lamportsToSol(biggestLoss.amountLamports) / runConfig.buyAmountSol) * 100,
    };
}

export function logStrategyResult(logger: Logger, sr: StrategyBacktestResult, tested: number, total: number) {
    logger.info('Total Profit/Loss: %s SOL', sr.totalPnlInSol);
    logger.info('Final balance: %s SOL', lamportsToSol(sr.finalBalanceLamports));
    logger.info('Total holdings value: %s SOL', sr.totalHoldingsValueInSol);
    logger.info('Total ROI %s%%', sr.totalRoi);
    logger.info('Win rate %s%%', sr.winRatePercentage);
    logger.info('Wins count %s', sr.winsCount);
    logger.info('Biggest win %s%%', sr.biggestWinPercentage);
    logger.info('Losses count %s', sr.lossesCount);
    logger.info('Biggest loss %s%%', sr.biggestLossPercentage);
    logger.info('Total trades count %d', sr.totalTradesCount);
    logger.info('Total buy trades count %d', sr.totalBuyTradesCount);
    logger.info('Total sell trades count %d\n', sr.totalSellTradesCount);
    logger.info('Total progress %s%%\n', (tested / total) * 100);
}

export async function storeBacktest(backtest: Backtest) {
    await db.table(Tables.Backtests).insert({
        id: backtest.id,
        config: backtest.config,
    });
}

export async function storeStrategyResult(
    backtestId: string,
    strategy: LaunchpadBotStrategy,
    sr: StrategyBacktestResult,
): Promise<void> {
    await db.table(Tables.StrategyResults).insert({
        backtest_id: backtestId,
        strategy: strategy.name,
        config_variant: strategy.configVariant,
        config: strategy.config,
        pln_sol: sr.totalPnlInSol,
        holdings_value_sol: sr.totalHoldingsValueInSol,
        roi: sr.totalRoi,
        win_rate: sr.winRatePercentage,
        wins_count: sr.winsCount,
        biggest_win_percentage: sr.biggestWinPercentage,
        losses_count: sr.lossesCount,
        biggest_loss_percentage: sr.biggestLossPercentage,
        total_trades_count: sr.totalTradesCount,
        buy_trades_count: sr.totalBuyTradesCount,
        sell_trades_count: sr.totalSellTradesCount,
    });
}
