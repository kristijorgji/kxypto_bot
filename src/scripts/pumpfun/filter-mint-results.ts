import fs from 'fs';

import { Command } from 'commander';
import { z } from 'zod';

import { logger } from '@src/logger';
import {
    DetermineReportPathSuccess,
    determineReportPath,
} from '@src/trading/backtesting/data/pumpfun/organizePumpfunFiles';
import { HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { checkInterval } from '@src/trading/strategies/launchpads/common';
import { intervalConfigSchema } from '@src/trading/strategies/types';
import { moveFile, walkDirFilesSyncRecursive } from '@src/utils/files';
import { reviveDates } from '@src/utils/json';

const configSchema = z.object({
    paths: z.array(z.string()),
    outputPath: z.string(),
    filters: z.object({
        minSchemaVersion: z.number().optional(),
        startedAtUnixSeconds: intervalConfigSchema.optional(),
    }),
    reportPath: z.string().optional(),
});

type FilterMintResultsConfig = z.infer<typeof configSchema>;

const command = new Command();
command
    .name('filter-mint-results')
    .description(
        `It will filter the files in the provided paths and move them into the destination folder
        while maintaining the original folder structure`,
    )
    .version('0.0.0')
    .requiredOption('--config <string>', 'path to a config file used')
    .option('--dry-run', 'Perform a dry run without making any changes')
    .action(async args => {
        await runWithArgs({
            dryRun: args.dryRun,
            config: args.config,
        });
    });

if (require.main === module) {
    command.parse(process.argv);
}

function runWithArgs(args: { dryRun: boolean; config: string }): ReturnType<typeof filterMintResults> {
    logger.debug('Running with args %o', args);
    return filterMintResults({
        dryRun: args.dryRun,
        ...configSchema.parse(JSON.parse(fs.readFileSync(args.config).toString())),
    });
}

/**
 * This script will search in the provided folders,
 * filter the mint results that match the given filters and move them in the destination path, organized.
 */
async function filterMintResults(config: FilterMintResultsConfig & { dryRun: boolean }): Promise<{
    excluded: Record<string, string>;
    valid: Record<string, string>;
}> {
    logger.info('Running filterMintResults script with config=%o', config);

    let processed = -1;
    const excluded: Record<string, string> = {};
    const valid: Record<string, string> = {};

    for (const dir of config.paths) {
        const files = walkDirFilesSyncRecursive(dir, [], 'json');
        for (const file of files) {
            processed++;
            let content: HandlePumpTokenReport;
            try {
                content = JSON.parse(fs.readFileSync(file.fullPath).toString(), reviveDates) as HandlePumpTokenReport;
            } catch (_) {
                throw new Error(`Error reading and parsing file ${file.fullPath}`);
            }

            if (config.filters.minSchemaVersion && content.$schema.version < config.filters.minSchemaVersion) {
                excluded[file.fullPath] = 'minSchemaVersion';
                logger.debug(
                    '[%d] Skipping file %s: schema version %d < min required %d',
                    processed,
                    file.fullPath,
                    content.$schema.version,
                    config.filters.minSchemaVersion,
                );
                continue;
            }

            if (
                config.filters.startedAtUnixSeconds &&
                !checkInterval(config.filters.startedAtUnixSeconds, content.startedAt.getTime() / 1000)
            ) {
                excluded[file.fullPath] = 'startedAtUnixSeconds';
                logger.debug(
                    '[%d] Skipping file %s: startedAt %s not within interval %o',
                    processed,
                    file.fullPath,
                    content.startedAt,
                    config.filters.startedAtUnixSeconds,
                );
                continue;
            }

            const drpr = determineReportPath(file.name, content, config.outputPath) as DetermineReportPathSuccess;
            valid[file.fullPath] = drpr.destFullPath;

            logger.debug(
                '[%d]%sMoving file from %s to %s',
                processed,
                config.dryRun ? '[dryRun] ' : '',
                file.fullPath,
                drpr.destFullPath,
            );
            if (!config.dryRun) {
                await moveFile(file.fullPath, drpr.destFullPath);
            }
        }
    }

    logger.info('%d files were processed', processed);
    logger.info('%d files were excluded', Object.keys(excluded).length);
    logger.info('%d files met the criteria', Object.keys(valid).length);
    logger.info('Moved eligible files=%o', valid);

    const result = {
        excluded: excluded,
        valid: valid,
    };

    if (config.reportPath) {
        logger.info('Writing results at %s', config.reportPath);
        fs.writeFileSync(config.reportPath, JSON.stringify(result, null, 2));
    }

    return result;
}
