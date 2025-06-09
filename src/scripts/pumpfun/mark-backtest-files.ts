import fs from 'fs';

import { logger } from '@src/logger';
import { formPumpfunStatsDataFolder } from '@src/trading/backtesting/data/pumpfun/utils';
import { walkDirFilesSyncRecursive } from '@src/utils/files';

import { HandlePumpTokenBotReport, HandlePumpTokenReport } from './bot';

if (require.main === module) {
    (async () => {
        await start();
    })();
}

/**
 * It will check all the backtest files under `./data/pumpfun-stats`
 * and detect in which ones we could have traded for profit
 */
async function start() {
    const pumpfunStatsPath = formPumpfunStatsDataFolder();
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json').filter(el =>
        el.fullPath.includes('no_trade'),
    );

    const config = {
        checkPriceAfterMs: 5e3,
        requiredPriceChangeDiffPercentage: 25,
        requiredMaintainIncreaseMs: 6e3,
        logOnlyProfitable: true,
    };

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    let processed = 0;
    let validFiles = 0;
    let validIntervals = 0;

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (!(content as HandlePumpTokenBotReport)?.history) {
            if (!config.logOnlyProfitable) {
                logger.info('[%d] Skipping file %s as it has no history', processed, file.fullPath);
            }
            processed++;
            continue;
        }

        const pc = content as HandlePumpTokenBotReport;
        const checkPriceAfterIntervals = Math.round(config.checkPriceAfterMs / pc.monitor.buyTimeframeMs);
        const requiredMaintainIncreaseIntervals = Math.round(
            config.requiredMaintainIncreaseMs / pc.monitor.buyTimeframeMs,
        );

        let maintainedChangeIntervals: {
            startRef: {
                timestamp: number;
                index: number;
            };
            count: number;
        } | null = null;
        type ProfitableInterval = {
            startTimestamp: number;
            count: number;
        };
        const intervals: Record<number, ProfitableInterval> = {};

        for (let i = 0; i < pc.history.length; i++) {
            const historyEntry = pc.history[i];

            const intervalStartIndex = maintainedChangeIntervals
                ? maintainedChangeIntervals.startRef.index + maintainedChangeIntervals.count
                : i;
            const nextEntry =
                pc.history[
                    intervalStartIndex + checkPriceAfterIntervals <= pc.history.length - 1
                        ? intervalStartIndex + checkPriceAfterIntervals
                        : pc.history.length - 1
                ];
            const nextPrice = nextEntry.price;
            const diffPercentage = ((nextPrice - historyEntry.price) / historyEntry.price) * 100;

            if (diffPercentage >= config.requiredPriceChangeDiffPercentage) {
                if (!maintainedChangeIntervals) {
                    maintainedChangeIntervals = {
                        startRef: {
                            timestamp: historyEntry.timestamp,
                            index: i,
                        },
                        count: 0,
                    };
                }
                maintainedChangeIntervals.count++;

                if (maintainedChangeIntervals.count >= requiredMaintainIncreaseIntervals) {
                    intervals[maintainedChangeIntervals.startRef.index] = {
                        startTimestamp: maintainedChangeIntervals.startRef.timestamp,
                        count: maintainedChangeIntervals.count,
                    };
                }
            } else {
                maintainedChangeIntervals = null;
            }
        }

        const winningIntervalsCount = Object.keys(intervals).length;

        if (!config.logOnlyProfitable || (config.logOnlyProfitable && winningIntervalsCount)) {
            logger.info('[%d] Processing file %s', processed, file.fullPath);
        }

        if (winningIntervalsCount > 0) {
            validFiles++;
            validIntervals += winningIntervalsCount;
            logger.info(
                '[%d] We found potential winning trades within these buy-sell intervals=%o\n',
                processed,
                Object.keys(intervals).reduce(
                    (acc: Record<number, { timestamp: number; count: number; timeMs: number }>, key) => {
                        const interval: ProfitableInterval = intervals[+key];
                        acc[+key] = {
                            timestamp: interval.startTimestamp,
                            count: interval.count,
                            timeMs: interval.count * pc.monitor.buyTimeframeMs,
                        };
                        return acc;
                    },
                    {} as Record<number, { timestamp: number; count: number; timeMs: number }>,
                ),
            );
        } else {
            if (!config.logOnlyProfitable) {
                logger.info('[%d] Could not find any possible winning trades with the provided config\n', processed);
            }
        }

        processed++;
    }

    logger.info('%d files were processed', processed);
    logger.info('%d files were found to be profitable', validFiles);
    logger.info('%d trade opportunities were found to be profitable', validIntervals);
}
