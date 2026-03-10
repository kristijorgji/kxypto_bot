import fs from 'fs';

import { Command } from 'commander';
import { z } from 'zod';

import { logger } from '@src/logger';
import { getScriptEnvConfig } from '@src/scripts/_utils';
import { analyzeMintResults } from '@src/scripts/pumpfun/analyze-mint-results';
import { HandlePumpTokenBotReport, HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { DerivedContextKey, MarketContextKey, marketContextKeys } from '@src/trading/bots/launchpads/types';

const configSchema = z
    .object({
        analyzeResultPath: z.string().min(1, 'Path is required'),
        reportPath: z.string().min(1, 'Report path is required'),
        ignoreNulls: z.boolean(),
        makeNullsZero: z.boolean(),
        ignoreZeros: z.boolean(),
    })
    .refine(data => !(data.ignoreNulls && data.makeNullsZero), {
        message: 'ignoreNulls and makeNullsZero cannot both be true',
        path: ['ignoreNulls'], // This highlights the specific field in error objects
    });

export type HeatmapConfig = z.infer<typeof configSchema>;

export type ContextValFrequencyMap = Record<MarketContextKey | DerivedContextKey | 'index', Record<number, number>>;

const command = new Command();
command
    .name('heatmap')
    .description('It will use analyze-mint-results report to build a heatmap json for visualising context')
    .version('0.0.0')
    .option('--config <string>', 'path to a config file used')
    .action(async args => {
        await runWithArgs({
            config: args.config,
        });
    });

if (require.main === module) {
    command.parse(process.argv);
}

function runWithArgs(args: { config: string }) {
    logger.debug('Running with args %o', args);

    let config: HeatmapConfig;
    if (args.config) {
        config = configSchema.parse(JSON.parse(fs.readFileSync(args.config).toString()));
    } else {
        config = configSchema.parse(getScriptEnvConfig(__filename));
    }

    return buildHeatmap(config);
}

export async function buildHeatmap(config: HeatmapConfig): Promise<Partial<ContextValFrequencyMap>> {
    logger.info('Started with config=%o', config);

    const analyzeResult: Awaited<ReturnType<typeof analyzeMintResults>> = JSON.parse(
        fs.readFileSync(config.analyzeResultPath).toString(),
    );

    const validFilesEntries = Object.entries(analyzeResult.validFiles);
    const totalFilesCount = validFilesEntries.length;
    logger.info('Will process %d files', totalFilesCount);

    const contextFrequency: Partial<ContextValFrequencyMap> = {};
    let processed = 0;

    for (const [mintResRelPath, winIntervalsMap] of validFilesEntries) {
        logger.debug('[%d/%d] Processing file %s', processed, totalFilesCount, mintResRelPath);

        const tokenReport = JSON.parse(fs.readFileSync(mintResRelPath).toString()) as HandlePumpTokenReport;
        const history = (tokenReport as HandlePumpTokenBotReport)?.history;

        if (!history || history.length === 0) {
            logger.warn('[%d] History is empty for %s', processed, mintResRelPath);
            continue;
        }

        for (const [indexStr, winInterval] of Object.entries(winIntervalsMap)) {
            const index = parseInt(indexStr);
            const context = history[index];

            incrementFrequencyKeyValue(contextFrequency, 'index', index);

            for (const key of marketContextKeys) {
                const k: MarketContextKey & DerivedContextKey = key as MarketContextKey & DerivedContextKey;
                let cVal: number = context[k];

                if (cVal === null) {
                    if (config.ignoreNulls) {
                        continue;
                    }

                    if (config.makeNullsZero) {
                        cVal = 0;
                    }
                }

                if (config.ignoreZeros && cVal === 0) {
                    continue;
                }

                const cValRounded: number = cVal === null ? cVal : Math.min(cVal);
                incrementFrequencyKeyValue(contextFrequency, k, cValRounded);
            }

            incrementFrequencyKeyValue(
                contextFrequency,
                'timeFromStartS',
                Math.floor((winInterval.startTimestamp - history[0].timestamp) / 1000),
            );
        }

        processed++;
    }

    logger.info('Writing results at %s', config.reportPath);
    fs.writeFileSync(config.reportPath, JSON.stringify(contextFrequency, null, 2));

    return contextFrequency;
}

function incrementFrequencyKeyValue(
    map: Partial<ContextValFrequencyMap>,
    key: keyof ContextValFrequencyMap,
    value: number,
): void {
    if (!map[key]) {
        map[key] = {};
    }
    if (!map[key][value]) {
        map[key][value] = 0;
    }

    map[key][value]++;
}
