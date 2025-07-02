import fs from 'fs';

import { Command } from 'commander';

import { logger } from '@src/logger';
import { NewMarketContextFactory } from '@src/testdata/factories/launchpad';
import { getBacktestFiles } from '@src/trading/backtesting/utils';
import { HandlePumpTokenBotReport, HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { MarketContext } from '@src/trading/bots/launchpads/types';
import { moveFile } from '@src/utils/files';

export const validateBacktestFilesProgram = new Command();
validateBacktestFilesProgram
    .name('validate-backtest-files')
    .description(
        'Validates files in the specified directory by checking for null values in the marketContext and other anomalies.',
    )
    .version('0.0.0')
    .requiredOption('--path <string>', 'Path to the folder containing the JSON result files to be validated.')
    .option(
        '--includeIfPathContains <string>',
        'Comma-separated list of keywords. Only files whose paths include at least one of these values will be processed.',
    )
    .option('--extractTo <string>', 'Destination folder to move invalid files')
    .action(async args => {
        await start({
            path: args.path,
            includeIfPathContains: args.includeIfPathContains,
            extractTo: args.extractTo,
        });
    });

if (require.main === module) {
    validateBacktestFilesProgram.parse(process.argv);
}

type Config = {
    dataSource: {
        path: string;
        includeIfPathContains: string[] | undefined;
    };
    rules: {
        notJson: boolean;
        nulls: {
            enabled: boolean;
            exclude: Partial<Record<keyof MarketContext, { upToIndex?: number }>>;
        };
        noHistory: boolean;
    };
    extractTo: string | undefined;
};

/**
 * It will check all the backtest files under default dir `./data/pumpfun-stats`
 * and provide a summary of how many are valid, how many invalid (e.g., have price = null)
 */
async function start(args: { path: string; includeIfPathContains: string; extractTo?: string }) {
    const config: Config = {
        dataSource: {
            path: args.path,
            includeIfPathContains: args.includeIfPathContains ? args.includeIfPathContains.split(',') : undefined,
        },
        rules: {
            notJson: true,
            nulls: {
                enabled: true,
                exclude: {
                    devHoldingPercentageCirculating: {
                        upToIndex: 12,
                    },
                    topTenHoldingPercentageCirculating: {
                        upToIndex: 12,
                    },
                },
            },
            noHistory: true,
        },
        extractTo: args.extractTo,
    };
    const files = getBacktestFiles(config.dataSource, null);
    const marketContextKeys = Object.keys(NewMarketContextFactory()) as (keyof MarketContext)[];

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    if (config.extractTo && !fs.existsSync(config.extractTo)) {
        logger.info('Will create missing extract-to directory %s', config.extractTo);
        fs.mkdirSync(config.extractTo, { recursive: true });
    }

    let processed = 0;
    let validFiles = 0;

    let lastNullIntervals: Partial<
        Record<
            keyof MarketContext,
            {
                startRef: {
                    timestamp: number;
                    index: number;
                };
                count: number;
            } | null
        >
    > = {};
    type Interval = {
        startTimestamp: number;
        count: number;
    };
    type IntervalsMap = Record<number, Interval>;
    const invalidFiles: Record<
        string,
        {
            nonJson?: boolean;
            withoutHistory?: boolean;
            context?: Partial<
                Record<
                    keyof MarketContext,
                    {
                        null: IntervalsMap;
                    }
                >
            >;
        }
    > = {};

    for (const file of files) {
        if (config.rules.notJson && !file.name.includes('.json')) {
            processed++;
            if (config.extractTo) {
                await moveFile(file.fullPath, `${config.extractTo}/not_json/${file.name}`);
            }
            invalidFiles[file.fullPath] = {
                nonJson: true,
            };
            continue;
        }

        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (config.rules.noHistory && !(content as HandlePumpTokenBotReport)?.history) {
            processed++;
            if (config.extractTo) {
                await moveFile(file.fullPath, `${config.extractTo}/without_history/${file.name}`);
            }
            invalidFiles[file.fullPath] = {
                withoutHistory: true,
            };
            continue;
        }

        const pc = content as HandlePumpTokenBotReport;

        let i = 0;
        for (; i < pc.history.length; i++) {
            const historyEntry = pc.history[i];

            for (const mKey of marketContextKeys) {
                const excludeRule = config.rules.nulls.exclude[mKey];
                if (excludeRule && (excludeRule?.upToIndex === undefined || excludeRule.upToIndex >= i)) {
                    continue;
                }

                if (historyEntry[mKey] === null) {
                    if (!invalidFiles[file.fullPath]) {
                        invalidFiles[file.fullPath] = {
                            context: {},
                        };
                    }
                    if (!invalidFiles[file.fullPath].context![mKey]) {
                        invalidFiles[file.fullPath].context![mKey] = {
                            null: {},
                        };
                    }

                    if (!lastNullIntervals[mKey]) {
                        lastNullIntervals[mKey] = {
                            startRef: {
                                timestamp: historyEntry.timestamp,
                                index: i,
                            },
                            count: 1,
                        };
                        invalidFiles[file.fullPath].context![mKey]!.null[lastNullIntervals[mKey].startRef.index] = {
                            startTimestamp: lastNullIntervals[mKey].startRef.timestamp,
                            count: 1,
                        };
                    }

                    if (
                        i > 0 &&
                        !(excludeRule && excludeRule.upToIndex && excludeRule.upToIndex + 1 === i) &&
                        pc.history[i - 1][mKey] === null
                    ) {
                        lastNullIntervals![mKey]!.count++;
                        invalidFiles[file.fullPath].context![mKey]!.null[
                            lastNullIntervals![mKey]!.startRef.index
                        ].count = lastNullIntervals![mKey]!.count;
                    }
                } else {
                    lastNullIntervals[mKey] = null;
                }
            }
        }
        if (!invalidFiles[file.fullPath]) {
            validFiles++;
        } else if (config.extractTo) {
            await moveFile(file.fullPath, `${config.extractTo}/nulls/${file.name}`);
        }

        processed++;
    }

    const invalidReasonCounts: Record<'context' | 'nonJson' | 'withoutHistory', number> = {
        nonJson: 0,
        context: 0,
        withoutHistory: 0,
    };
    let invalidFilesCount = 0;
    for (const [_, value] of Object.entries(invalidFiles)) {
        invalidFilesCount++;
        if (value.nonJson === true) {
            invalidReasonCounts.nonJson++;
        }
        if (value.withoutHistory === true) {
            invalidReasonCounts.withoutHistory++;
        }
        if (value.context) {
            invalidReasonCounts.context++;
        }
    }

    logger.info('%d files were processed', processed);
    logger.info('%d files were found to be valid', validFiles);
    logger.info('%d files were found to be invalid', invalidFilesCount);
    logger.info('Invalid files invalidReasonCounts by reason: %o', invalidReasonCounts);
    logger.info('Invalid files: %o', invalidFiles);
}
