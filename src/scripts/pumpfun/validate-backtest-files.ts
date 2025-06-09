import fs from 'fs';

import { Command } from 'commander';

import { logger } from '@src/logger';
import { NewMarketContextFactory } from '@src/testdata/factories/launchpad';
import { formPumpfunStatsDataFolder } from '@src/trading/backtesting/data/pumpfun/utils';
import { getBacktestFiles } from '@src/trading/backtesting/utils';
import { MarketContext } from '@src/trading/bots/launchpads/types';

import { HandlePumpTokenBotReport, HandlePumpTokenReport } from './bot';

export const validateBacktestFilesProgram = new Command();
validateBacktestFilesProgram
    .name('validate-backtest-files')
    .description(
        'Validates JSON files in the specified directory by checking for null values in the marketContext and other anomalies.',
    )
    .version('0.0.0')
    .option('--path <string>', 'Path to the folder containing the JSON result files to be validated.')
    .option(
        '--includeIfPathContains <string>',
        'Comma-separated list of keywords. Only files whose paths include at least one of these values will be processed.',
    )
    .action(async args => {
        await start({
            path: args.path,
            includeIfPathContains: args.includeIfPathContains,
        });
    });

if (require.main === module) {
    validateBacktestFilesProgram.parse(process.argv);
}

/**
 * It will check all the backtest files under default dir `./data/pumpfun-stats`
 * and provide a summary of how many are valid, how many invalid (e.g., have price = null)
 */
async function start(args: { path?: string; includeIfPathContains?: string }) {
    const config = {
        dataSource: {
            path: args.path ?? formPumpfunStatsDataFolder(),
            includeIfPathContains: args.includeIfPathContains ? args.includeIfPathContains.split(',') : ['no_trade'],
        },
        rules: {
            nulls: true,
        },
    };
    const files = getBacktestFiles(config.dataSource);
    const marketContextKeys = Object.keys(NewMarketContextFactory()) as (keyof MarketContext)[];

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    let withoutHistory = 0;
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
        Partial<
            Record<
                keyof MarketContext,
                {
                    null: IntervalsMap;
                }
            >
        >
    > = {};

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (!(content as HandlePumpTokenBotReport)?.history) {
            withoutHistory++;
            processed++;
            continue;
        }

        const pc = content as HandlePumpTokenBotReport;

        let i = 0;
        for (; i < pc.history.length; i++) {
            const historyEntry = pc.history[i];

            for (const mKey of marketContextKeys) {
                if (historyEntry[mKey] === null) {
                    if (!invalidFiles[file.fullPath]) {
                        invalidFiles[file.fullPath] = {};
                    }
                    if (!invalidFiles[file.fullPath][mKey]) {
                        invalidFiles[file.fullPath][mKey] = {
                            null: {},
                        };
                    }

                    if (i > 0 && pc.history[i - 1][mKey] === null) {
                        lastNullIntervals![mKey]!.count++;
                        invalidFiles[file.fullPath][mKey]!.null[lastNullIntervals![mKey]!.startRef.index].count =
                            lastNullIntervals![mKey]!.count;
                    } else {
                        lastNullIntervals[mKey] = {
                            startRef: {
                                timestamp: historyEntry.timestamp,
                                index: i,
                            },
                            count: 1,
                        };
                        invalidFiles[file.fullPath][mKey]!.null[lastNullIntervals[mKey].startRef.index] = {
                            startTimestamp: lastNullIntervals[mKey].startRef.timestamp,
                            count: 1,
                        };
                    }
                } else {
                    lastNullIntervals[mKey] = null;
                }
            }
        }
        if (!invalidFiles[file.fullPath]) {
            validFiles++;
        }

        processed++;
    }

    logger.info('%d files were processed', processed);
    logger.info('%d files were found to be valid', validFiles);
    logger.info('%d files were found to be invalid', Object.keys(invalidFiles).length);
    logger.info('%d files had no history', withoutHistory);
    logger.info('Invalid files: %o', invalidFiles);
}
