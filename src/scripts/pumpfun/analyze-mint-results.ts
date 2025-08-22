import fs from 'fs';

import { Command } from 'commander';
import { z } from 'zod';

import { dataSourceSchema } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { logger } from '@src/logger';
import { HandlePumpTokenBotReport, HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';

const configSchema = z.object({
    dataSource: dataSourceSchema,
    checkPriceAfterMs: z.number(),
    allowedPriceDropInBetweenPercentage: z.number().optional(),
    requiredPriceChangeDiffPercentage: z.number(),
    requiredMaintainIncreaseMs: z.number(),
    startFromIndex: z.number(),
    logOnlyProfitable: z.boolean().optional(),
    reportPath: z.string().optional(),
});

type PriceDiffInterval = {
    startTimestamp: number;
    endTimestamp: number;
    length: number;
    timeMs: number;
    startingPriceDiffPercentage: number;
    endingPriceDiffPercentage: number;
};

type PriceDiffIntervalsMap = Record<number, PriceDiffInterval>;

type ValidFiles = Record<string, PriceDiffIntervalsMap>;

const command = new Command();
command
    .name('analyze-mint-results')
    .description('It report the mint results in the provided path that fill the given criteria')
    .version('0.0.0')
    .requiredOption('--config <string>', 'path to a config file used')
    .action(async args => {
        await runWithArgs({
            config: args.config,
        });
    });

export type AnalyzeMintResultsConfig = z.infer<typeof configSchema>;

if (require.main === module) {
    command.parse(process.argv);
}

function runWithArgs(args: { config: string; path?: string; extractTo?: string }) {
    logger.debug('Running with args %o', args);
    return analyzeMintResults(configSchema.parse(JSON.parse(fs.readFileSync(args.config).toString())));
}

export async function analyzeMintResults(config: AnalyzeMintResultsConfig): Promise<{
    processed: number;
    filesWithoutEnoughHistory: string[];
    filesWithoutHistory: string[];
    validFiles: ValidFiles;
}> {
    const files = getFiles(config.dataSource, null);

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    let processed = 0;
    const filesWithoutEnoughHistory = [];
    const filesWithoutHistory = [];
    let validFiles: ValidFiles = {};
    let validIntervals = 0;

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (!(content as HandlePumpTokenBotReport)?.history) {
            if (!config.logOnlyProfitable) {
                logger.info('[%d] Skipping file %s as it has no history', processed, file.fullPath);
            }
            processed++;
            filesWithoutHistory.push(file.fullPath);
            continue;
        }

        const pc = content as HandlePumpTokenBotReport;

        if (pc.history.length < config.startFromIndex + 1) {
            if (!config.logOnlyProfitable) {
                logger.info(
                    `[%d] Skipping file %s as it history with length less than ${config.startFromIndex + 1}`,
                    processed,
                    file.fullPath,
                );
            }
            processed++;
            filesWithoutEnoughHistory.push(file.fullPath);
            continue;
        }

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
            timeMs: number;
            startingDiffPercentage: number;
        } | null = null;

        const intervals: PriceDiffIntervalsMap = {};

        for (let i = config.startFromIndex; i < pc.history.length - 1; i++) {
            const historyEntry = pc.history[i];
            const nextEntryIndex = i + checkPriceAfterIntervals;

            if (nextEntryIndex > pc.history.length - 1) {
                break;
            }

            /**
             * Make sure that the intervals in between don't lower in price more than allowed in config
             */
            let priceWentLower = false;
            for (let j = i + 1; j < nextEntryIndex; j++) {
                const maxLowerPrice =
                    historyEntry.price * (1 - (config?.allowedPriceDropInBetweenPercentage ?? 0) / 100);
                if (pc.history[j].price < maxLowerPrice) {
                    priceWentLower = true;
                    break;
                }
            }
            if (priceWentLower) {
                maintainedChangeIntervals = null;
                continue;
            }

            for (let j = nextEntryIndex; j < pc.history.length; j++) {
                const nextPrice = pc.history[j].price;
                const diffPercentage = ((nextPrice - historyEntry.price) / historyEntry.price) * 100;

                if (
                    diffPercentage >= config.requiredPriceChangeDiffPercentage &&
                    (!maintainedChangeIntervals || maintainedChangeIntervals.startRef.index === i)
                ) {
                    if (!maintainedChangeIntervals) {
                        maintainedChangeIntervals = {
                            startRef: {
                                timestamp: historyEntry.timestamp,
                                index: i,
                            },
                            count: 0,
                            timeMs: 0,
                            startingDiffPercentage: diffPercentage,
                        };
                    }
                    maintainedChangeIntervals.count++;
                    maintainedChangeIntervals.timeMs += pc.monitor.buyTimeframeMs;

                    if (maintainedChangeIntervals.count >= requiredMaintainIncreaseIntervals) {
                        intervals[maintainedChangeIntervals.startRef.index] = {
                            startTimestamp: maintainedChangeIntervals.startRef.timestamp,
                            endTimestamp: pc.history[j].timestamp,
                            length: maintainedChangeIntervals.count,
                            timeMs: maintainedChangeIntervals.timeMs,
                            startingPriceDiffPercentage: maintainedChangeIntervals.startingDiffPercentage,
                            endingPriceDiffPercentage: diffPercentage,
                        };
                    }
                } else {
                    maintainedChangeIntervals = null;
                    break;
                }
            }
        }

        const winningIntervalsCount = Object.keys(intervals).length;

        if (!config.logOnlyProfitable || (config.logOnlyProfitable && winningIntervalsCount)) {
            logger.info('[%d] Processing file %s', processed, file.fullPath);
        }

        if (winningIntervalsCount > 0) {
            validFiles[file.fullPath] = intervals;
            validIntervals += winningIntervalsCount;
            logger.info(
                '[%d] We found potential winning trades within these buy-sell intervals=%o\n',
                processed,
                intervals,
            );
        } else {
            if (!config.logOnlyProfitable) {
                logger.info('[%d] Could not find any possible winning trades with the provided config\n', processed);
            }
        }

        processed++;
    }

    logger.info('%d files were processed', processed);
    logger.info(
        '%d files were valid with history and enough length',
        processed - filesWithoutHistory.length - filesWithoutEnoughHistory.length,
    );
    logger.info('%d files were found to be profitable', Object.keys(validFiles).length);
    logger.info('%d trade opportunities were found to be profitable', validIntervals);

    const result: Awaited<ReturnType<typeof analyzeMintResults>> = {
        processed: processed,
        filesWithoutEnoughHistory: filesWithoutEnoughHistory,
        filesWithoutHistory: filesWithoutHistory,
        validFiles: validFiles,
    };

    if (config.reportPath) {
        logger.info('Writing results at %s', config.reportPath);
        fs.writeFileSync(config.reportPath, JSON.stringify(result, null, 2));
    }

    return result;
}
