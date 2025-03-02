import fs from 'fs';

import { Logger } from 'winston';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { forceGetPumpCoinInitialData } from '../../blockchains/solana/dex/pumpfun/utils';
import { lamportsToSol } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { pumpfunRepository } from '../../db/repositories/PumpfunRepository';
import { Tables } from '../../db/tables';
import { Backtest } from '../../db/types';
import { logger } from '../../logger';
import { HandlePumpTokenReport } from '../../scripts/pumpfun/bot';
import { FileInfo } from '../../utils/files';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestExitResponse,
    BacktestRunConfig,
    BacktestTradeResponse,
    StrategyBacktestResult,
} from '../bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../strategies/launchpads/LaunchpadBotStrategy';

const cache: Record<string, HandlePumpTokenReport> = {};

export async function runStrategy(
    {
        backtester,
        pumpfun,
    }: {
        backtester: PumpfunBacktester;
        pumpfun: Pumpfun;
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
    let totalRoi = 0;
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
        let content: HandlePumpTokenReport;
        if (cache[file.fullPath]) {
            content = cache[file.fullPath];
        } else {
            content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;
            cache[file.fullPath] = content;
        }

        const initialCoinData = await forceGetPumpCoinInitialData(pumpfun, pumpfunRepository, content.mint);
        try {
            const r = await backtester.run(runConfig, initialCoinData, content.history);
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
                    totalRoi += pr.roi;

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
                        logger.info('Max Drawdown: %s%%\n', pr.maxDrawdown);
                    }
                }

                balanceLamports += pr.profitLossLamports;
                if (!runConfig.allowNegativeBalance && balanceLamports <= 0) {
                    logger.info('Stopping because reached <=0 balance: %s SOL', lamportsToSol(balanceLamports));
                    break;
                }
            } else {
                const pr = r as BacktestExitResponse;
                if (verbose) {
                    logger.info('Exited monitoring with code: %s, reason: %s\n', pr.exitCode, pr.exitReason);
                }
            }
        } catch (e) {
            logger.error('Error handling mint %s', initialCoinData.mint);
            logger.info(e);
        }

        processed++;

        if (processed === maxToProcess) {
            logger.info('Processed maxToProcess=%d files and will stop', maxToProcess);
            break;
        }
    }

    return {
        totalPnlInSol: lamportsToSol(totalProfitLossLamports),
        totalHoldingsValueInSol: lamportsToSol(totalHoldingsValueInLamports),
        totalRoi: totalRoi,
        totalTradesCount: totalTradesCount,
        totalBuyTradesCount: totalBuyTradesCount,
        totalSellTradesCount: totalSellTradesCount,
        winRatePercentage: (winsCount / (winsCount + lossesCount)) * 100,
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
