import fs from 'fs';

import { Logger } from 'winston';

import { forceGetPumpCoinInitialData } from '@src/blockchains/solana/dex/pumpfun/utils';
import { lamportsToSol, solToLamports } from '@src/blockchains/utils/amount';
import { pumpfunRepository } from '@src/db/repositories/PumpfunRepository';
import { FileInfo } from '@src/utils/files';
import { sleep } from '@src/utils/functions';
import { formatElapsedTime } from '@src/utils/time';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestMintExitResponse,
    BacktestMintResponse,
    BacktestMintTradeResponse,
    BacktestStrategyRunConfig,
    HandlePumpTokenBotReport,
    PumpfunSellPositionMetadata,
    StrategyBacktestResult,
    StrategyMintBacktestResult,
} from '../bots/blockchains/solana/types';

export type StrategyResultLiveState = {
    currentIndex: number;
    balanceLamports: number;
    totalProfitLossLamports: number;
    totalTradesCount: number;
    totalBuyTradesCount: number;
    totalSellTradesCount: number;
    winRatePercentage: number;
    roi: number;
    holdingsValueInLamports: number;
    winsCount: number;
    lossesCount: number;
    highestPeakLamports: number;
    lowestTroughLamports: number;
    currentPeakLamports: number;
    currentTroughLamports: number;
    maxDrawdownPercentage: number;
};

export function createInitialStrategyResultLiveState(): StrategyResultLiveState {
    return {
        currentIndex: 0,
        balanceLamports: 0,
        totalProfitLossLamports: 0,
        totalTradesCount: 0,
        totalBuyTradesCount: 0,
        totalSellTradesCount: 0,
        winRatePercentage: 0,
        roi: 0,
        holdingsValueInLamports: 0,
        winsCount: 0,
        lossesCount: 0,
        highestPeakLamports: 0,
        lowestTroughLamports: 0,
        currentPeakLamports: 0,
        currentTroughLamports: 0,
        maxDrawdownPercentage: 0,
    };
}

const cache: Record<string, HandlePumpTokenBotReport> = {};

export type RunStrategyConfig = {
    logging?: {
        level?: 'none' | 'info' | 'verbose';
        includeTrades?: boolean;
    };
    onMintResult?: (mr: StrategyMintBacktestResult) => void | Promise<void>;
};

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
    {
        ls,
        pausedRef,
        abortedRef,
    }: {
        ls: StrategyResultLiveState;
        pausedRef: () => boolean;
        abortedRef: () => boolean;
    },
    runConfig: BacktestStrategyRunConfig,
    files: FileInfo[],
    config?: RunStrategyConfig,
): Promise<StrategyBacktestResult> {
    const logLevel = config?.logging?.level ?? 'info';
    const showTrades = config?.logging?.includeTrades ?? false;
    const isVerbose = logLevel === 'verbose';
    const isInfo = logLevel === 'info' || isVerbose;

    const buyAmountLamports = solToLamports(runConfig.buyAmountSol);

    ls.balanceLamports = runConfig.initialBalanceLamports;
    ls.highestPeakLamports = runConfig.initialBalanceLamports;
    ls.lowestTroughLamports = runConfig.initialBalanceLamports;
    ls.currentPeakLamports = runConfig.initialBalanceLamports;
    ls.currentTroughLamports = runConfig.initialBalanceLamports;
    ls.maxDrawdownPercentage = 0;
    let biggestWin: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: -1,
    };
    let biggestLoss: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: 1,
    };
    const mintResults: Record<string, StrategyMintBacktestResult> = {};

    for (let i = 0; i < files.length; i++) {
        ls.currentIndex = i;

        while (pausedRef()) {
            await sleep(150);
        }

        if (abortedRef()) {
            if (isVerbose) {
                logger.info('[%d] Aborting runStrategy', i);
            }
            break;
        }

        const file = files[i];

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
                    initialBalanceLamports: ls.balanceLamports,
                },
                initialCoinData,
                content.history,
                content.monitor,
            );
            runConfig.strategy.resetState();
            mintResults[content.mint] = {
                index: i,
                mint: content.mint,
                mintFileStorageType: 'local',
                mintFilePath: file.fullPath,
                backtestResponse: r,
                createdAt: new Date(),
            };
            if (config?.onMintResult) {
                config.onMintResult(mintResults[content.mint]);
            }

            if (isVerbose) {
                logger.info(
                    '[%d] Results for mint: %s, %s, %s',
                    i,
                    initialCoinData.mint,
                    initialCoinData.name,
                    initialCoinData.symbol,
                );
            }

            if ((r as BacktestMintTradeResponse).tradeHistory) {
                const pr = r as BacktestMintTradeResponse;

                if (pr.tradeHistory.length > 0) {
                    ls.totalProfitLossLamports += pr.profitLossLamports;
                    ls.holdingsValueInLamports += pr.holdings.lamportsValue;

                    ls.totalTradesCount += pr.tradeHistory.length;
                    const buysTrades = pr.tradeHistory.filter(e => e.transactionType === 'buy').length;
                    ls.totalBuyTradesCount += buysTrades;
                    ls.totalSellTradesCount += pr.tradeHistory.length - buysTrades;

                    if (pr.profitLossLamports >= 0) {
                        ls.winsCount++;
                        if (biggestWin.amountLamports < pr.profitLossLamports) {
                            biggestWin = {
                                mint: content.mint,
                                amountLamports: pr.profitLossLamports,
                            };
                        }
                    } else {
                        ls.lossesCount++;
                        if (biggestLoss.amountLamports > pr.profitLossLamports) {
                            biggestLoss = {
                                mint: content.mint,
                                amountLamports: pr.profitLossLamports,
                            };
                        }
                    }

                    if (isVerbose) {
                        logger.info(
                            '[%d] Final balance: %s SOL and holdings %s',
                            i,
                            lamportsToSol(pr.finalBalanceLamports),
                            pr.holdings.amountRaw,
                        );
                        logger.info('[%d] Profit/Loss: %s SOL', i, lamportsToSol(pr.profitLossLamports));
                        logger.info(
                            '[%d] Holdings amount: %s, value: %s SOL',
                            i,
                            pr.holdings.amountRaw,
                            lamportsToSol(pr.holdings.lamportsValue),
                        );
                        logger.info('[%d] Trades count %d', i, pr.tradeHistory.length);
                        logger.info('[%d] ROI %s%%', i, pr.roi);
                        logger.info('[%d] Max Drawdown: %s%%%s', i, pr.maxDrawdownPercentage, showTrades ? '' : '\n');
                        if (showTrades) {
                            logger.info(
                                '[%d] Trades=%o\n',
                                i,
                                pr.tradeHistory.map(e => {
                                    const { historyRef, ...filteredMetadata } = e.metadata!;

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
                    if (isVerbose) {
                        logger.info(
                            '[%d] Completed full simulation — no trades executed across %d history entries\n',
                            i,
                            content.history.length,
                        );
                    }
                }

                ls.roi = (ls.totalProfitLossLamports / runConfig.initialBalanceLamports) * 100;
                ls.winRatePercentage =
                    ls.totalTradesCount === 0 ? 0 : (ls.winsCount / (ls.winsCount + ls.lossesCount)) * 100;
                ls.balanceLamports += pr.profitLossLamports;

                if (ls.balanceLamports > ls.currentPeakLamports) {
                    ls.currentPeakLamports = ls.balanceLamports;
                    ls.currentTroughLamports = ls.balanceLamports; // reset trough on new peak

                    // update all-time peak
                    ls.highestPeakLamports = Math.max(ls.highestPeakLamports, ls.currentPeakLamports);
                } else if (ls.balanceLamports < ls.currentTroughLamports) {
                    ls.currentTroughLamports = ls.balanceLamports;

                    // update all-time trough
                    ls.lowestTroughLamports = Math.min(ls.lowestTroughLamports, ls.currentTroughLamports);

                    const drawdownPercentage =
                        ((ls.currentPeakLamports - ls.currentTroughLamports) / ls.currentPeakLamports) * 100;
                    ls.maxDrawdownPercentage = Math.max(ls.maxDrawdownPercentage, drawdownPercentage);
                }

                if (ls.balanceLamports <= 0) {
                    isInfo &&
                        logger.info(
                            '[%d] Stopping because reached <=0 balance: %s SOL',
                            i,
                            lamportsToSol(ls.balanceLamports),
                        );
                    break;
                }

                if (ls.balanceLamports <= buyAmountLamports) {
                    isInfo &&
                        logger.info(
                            '[%d] Stopping because reached balance (%s SOL) <= buyAmount (%s SOL)',
                            i,
                            lamportsToSol(ls.balanceLamports),
                            runConfig.buyAmountSol,
                        );
                    break;
                }
            } else {
                const pr = r as BacktestMintExitResponse;
                if (isVerbose) {
                    logger.info('[%d] Exited monitoring with code: %s, reason: %s\n', i, pr.exitCode, pr.exitReason);
                }
            }
        } catch (e) {
            logger.error('[%d] Error handling mint %s', i, initialCoinData.mint);
            logger.info(e);
        }
    }

    return {
        totalPnlInSol: lamportsToSol(ls.totalProfitLossLamports),
        finalBalanceLamports: ls.balanceLamports,
        totalHoldingsValueInSol: lamportsToSol(ls.holdingsValueInLamports),
        totalRoi: ls.roi,
        totalTradesCount: ls.totalTradesCount,
        totalBuyTradesCount: ls.totalBuyTradesCount,
        totalSellTradesCount: ls.totalSellTradesCount,
        winRatePercentage: ls.winRatePercentage,
        winsCount: ls.winsCount,
        biggestWinPercentage:
            ls.winsCount === 0 ? 0 : (lamportsToSol(biggestWin.amountLamports) / runConfig.buyAmountSol) * 100,
        lossesCount: ls.lossesCount,
        biggestLossPercentage:
            ls.lossesCount === 0 ? 0 : (lamportsToSol(biggestLoss.amountLamports) / runConfig.buyAmountSol) * 100,
        highestPeakLamports: ls.highestPeakLamports,
        lowestTroughLamports: ls.lowestTroughLamports,
        maxDrawdownPercentage: ls.maxDrawdownPercentage,
        mintResults: mintResults,
    };
}

export function logStrategyResult(
    logger: Logger,
    info: {
        strategyId: string;
        tested: number;
        total: number;
        executionTimeInS: number;
    },
    sr: StrategyBacktestResult,
) {
    logger.info('Finished testing strategy %s in %s', info.strategyId, formatElapsedTime(info.executionTimeInS));
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
    logger.info('Total sell trades count %d', sr.totalSellTradesCount);
    const sellReasons: Record<string, number> = {};
    for (const mint in sr.mintResults) {
        const backtestResponse: BacktestMintResponse = sr.mintResults[mint].backtestResponse;
        if ((backtestResponse as BacktestMintTradeResponse).tradeHistory) {
            for (const tradeTransaction of (backtestResponse as BacktestMintTradeResponse).tradeHistory) {
                if (tradeTransaction.transactionType !== 'sell') {
                    continue;
                }

                const sellReason = (tradeTransaction.metadata as unknown as PumpfunSellPositionMetadata).reason;
                if (!sellReasons[sellReason]) {
                    sellReasons[sellReason] = 0;
                }

                sellReasons[sellReason]++;
            }
        }
    }
    logger.info('Sell reasons=%o', sellReasons);
    logger.info('Highest peak: %s SOL', lamportsToSol(sr.highestPeakLamports));
    logger.info('Lowest trough: %s SOL', lamportsToSol(sr.lowestTroughLamports));
    logger.info('Max Drawdown: %s%%', sr.maxDrawdownPercentage);
    logger.info(
        'Total progress %s%%, %s\n',
        ((info.tested + 1) / info.total) * 100,
        `${info.tested + 1} / ${info.total}`,
    );
}
