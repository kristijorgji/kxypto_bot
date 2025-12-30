import fs from 'fs';

import { Command } from 'commander';
import { z } from 'zod';

import { dataSourceSchema } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { logger } from '@src/logger';
import { NewMarketContextFactory } from '@src/testdata/factories/launchpad';
import { HandlePumpTokenBotReport, HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { MarketContext, marketContextKeys } from '@src/trading/bots/launchpads/types';
import { moveFile } from '@src/utils/files';

const configSchema = z.object({
    dataSource: dataSourceSchema,
    rules: z.object({
        notJson: z.boolean(),
        nulls: z.object({
            enabled: z.boolean(),
            exclude: z
                .record(
                    z.enum(marketContextKeys),
                    z.object({
                        upToIndex: z.number().optional(),
                    }),
                )
                .optional(),
        }),
        noHistory: z.boolean(),
        minHistoryLength: z.number().positive().optional(),
    }),
    extractTo: z.string().optional(),
    reportPath: z.string().optional(),
});

export type ValidateBacktestFilesConfig = z.infer<typeof configSchema>;

type Interval = {
    startTimestamp: number;
    length: number;
};

type IntervalsMap = Record<number, Interval>;

type InvalidFiles = Record<
    string,
    {
        nonJson?: boolean;
        withoutHistory?: boolean;
        historyLength?: number;
        context?: Partial<
            Record<
                keyof MarketContext,
                {
                    null: IntervalsMap;
                }
            >
        >;
    }
>;

type InvalidReasonCounts = Record<'context' | 'nonJson' | 'withoutHistory' | 'historyLength', number>;

export const validateBacktestFilesProgram = new Command();
validateBacktestFilesProgram
    .name('validate-backtest-files')
    .description(
        'Validates files in the specified directory by checking for null values in the marketContext and other anomalies.',
    )
    .version('0.0.0')
    .requiredOption('--config <string>', 'path to a config file used')
    .option('--path <string>', 'Path to the folder containing the JSON result files to be validated.')
    .option('--extractTo <string>', 'Destination folder to move invalid files')
    .action(async args => {
        await runWithArgs({
            config: args.config,
            path: args.path,
            extractTo: args.extractTo,
        });
    });

if (require.main === module) {
    validateBacktestFilesProgram.parse(process.argv);
}

function runWithArgs(args: { config: string; path?: string; extractTo?: string }) {
    logger.debug('Running with args %o', args);

    const asJson = JSON.parse(fs.readFileSync(args.config).toString());
    const config = configSchema.parse(asJson);
    if (args.path) {
        config.dataSource.path = args.path;
    }
    if (args.extractTo !== undefined) {
        if (args.extractTo === '') {
            config.extractTo = undefined;
        } else {
            config.extractTo = args.extractTo;
        }
    }

    return validateBacktestFiles(config);
}

/**
 * It will check all the backtest files under the provided path
 * and provide a summary of how many are valid, how many invalid (e.g., have price = null)
 */
export async function validateBacktestFiles(config: ValidateBacktestFilesConfig): Promise<{
    processed: number;
    validFilesCount: number;
    invalidFiles: InvalidFiles;
    invalidFilesCount: number;
    invalidReasonCounts: InvalidReasonCounts;
}> {
    const files = getFiles(config.dataSource, null);
    const marketContextKeys = Object.keys(NewMarketContextFactory()) as (keyof MarketContext)[];

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    if (config.extractTo && !fs.existsSync(config.extractTo)) {
        logger.info('Will create missing extract-to directory %s', config.extractTo);
        fs.mkdirSync(config.extractTo, { recursive: true });
    }

    let processed = 0;
    let validFilesCount = 0;

    const invalidFiles: InvalidFiles = {};

    for (const file of files) {
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
        const historyLength = pc.history.length;

        if (config.rules.minHistoryLength && historyLength < config.rules.minHistoryLength) {
            processed++;
            if (config.extractTo) {
                await moveFile(
                    file.fullPath,
                    `${config.extractTo}/history_length_less_than_${config.rules.minHistoryLength}/${file.name}`,
                );
            }
            invalidFiles[file.fullPath] = {
                historyLength: historyLength,
            };
            continue;
        }

        let i = 0;
        for (; i < historyLength; i++) {
            const historyEntry = pc.history[i];

            for (const mKey of marketContextKeys) {
                const excludeRule = config.rules.nulls.exclude ? config.rules.nulls.exclude[mKey] : undefined;
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
                            length: 1,
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
                        ].length = lastNullIntervals![mKey]!.count;
                    }
                } else {
                    lastNullIntervals[mKey] = null;
                }
            }
        }
        if (!invalidFiles[file.fullPath]) {
            validFilesCount++;
        } else if (config.extractTo) {
            await moveFile(file.fullPath, `${config.extractTo}/nulls/${file.name}`);
        }

        processed++;
    }

    const invalidReasonCounts: InvalidReasonCounts = {
        nonJson: 0,
        context: 0,
        withoutHistory: 0,
        historyLength: 0,
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
        if (value.historyLength) {
            invalidReasonCounts.historyLength++;
        }
        if (value.context) {
            invalidReasonCounts.context++;
        }
    }

    logger.info('%d files were processed', processed);
    logger.info('%d files were found to be valid', validFilesCount);
    logger.info('%d files were found to be invalid', invalidFilesCount);
    logger.info('Invalid files invalidReasonCounts by reason: %o', invalidReasonCounts);
    logger.info('Invalid files: %o', invalidFiles);

    const result: Awaited<ReturnType<typeof validateBacktestFiles>> = {
        processed: processed,
        validFilesCount: validFilesCount,
        invalidFiles: invalidFiles,
        invalidFilesCount: invalidFilesCount,
        invalidReasonCounts: invalidReasonCounts,
    };

    if (config.reportPath) {
        logger.info('Writing results at %s', config.reportPath);
        fs.writeFileSync(config.reportPath, JSON.stringify(result, null, 2));
    }

    return result;
}
