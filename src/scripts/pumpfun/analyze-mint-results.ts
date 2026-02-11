import fs from 'fs';

import { Command } from 'commander';
import { z } from 'zod';

import { dataSourceSchema } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import { logger } from '@src/logger';
import { HandlePumpTokenBotReport, HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { FileInfo } from '@src/utils/files';

// --- CONFIGURATION SCHEMA ---

const baseConfigSchema = z.object({
    dataSources: z.array(dataSourceSchema),
    startFromIndex: z.number(),
    checkPriceAfterMs: z
        .number()
        .describe('PROFIT: Time to wait before checking target. RUG: Max time window for rug to happen.'),
    onlyLogEvents: z.boolean().optional().default(false),
    reportPath: z.string().optional(),
});

const profitConfigSchema = baseConfigSchema.extend({
    mode: z.literal('PROFIT'),
    requiredPriceChangeDiffPercentage: z.number().describe('Target increase percentage.'),
    allowedPriceDropInBetweenPercentage: z.number().describe('Max allowed drop (safety floor) at ANY point.'),
    requiredMaintainIncreaseMs: z.number().describe('How long target must be held.'),
});

const rugConfigSchema = baseConfigSchema.extend({
    mode: z.literal('RUG'),
    rugThresholdPercentage: z.number().describe('Drop percentage to consider a rug (e.g. 50 for -50%).'),
});

const configSchema = z.discriminatedUnion('mode', [profitConfigSchema, rugConfigSchema]);

export type AnalyzeMintResultsConfig = z.infer<typeof configSchema>;

// --- TYPES ---

/**
 * Represents a successful "Profit Window" where the price reached a target
 * and maintained it for the required duration.
 */
type WinInterval = {
    type: 'WIN';

    /** * The Unix timestamp (ms) of the initial 'buy' trigger.
     * This corresponds to index [i] in the history array.
     */
    startTimestamp: number;

    /** * The Unix timestamp (ms) at the moment of final confirmation.
     * This is the point where the maintenance period successfully ended.
     */
    endTimestamp: number;

    /** * The total number of data ticks/indices spanned from the buy [i]
     * to the final confirmation [j].
     */
    length: number;

    /** * The total duration of the trade in milliseconds.
     * Calculated as (endTimestamp - startTimestamp).
     */
    timeMs: number;

    /** * The specific number of data ticks recorded during the "holding" phase.
     * This represents the density of data while the price was above the target.
     */
    maintainedLength: number;

    /** * The total time in milliseconds the price was held above the target threshold.
     * Calculated as (endTimestamp - maintenanceStartTime).
     */
    maintainedTimeMs: number;

    /** * The price percentage difference relative to the buy price at the exact
     * second the maintenance timer was triggered.
     */
    startingPriceDiffPercentage: number;

    /** * The price percentage difference relative to the buy price at the
     * moment the WIN was officially confirmed and closed.
     */
    endingPriceDiffPercentage: number;
};

/**
 * Represents a "Danger Event" where the price collapsed below the
 * defined safety threshold after a simulated buy.
 */
type RugInterval = {
    type: 'RUG';

    /** * The Unix timestamp (ms) of the simulated 'buy' entry.
     * This is the starting point of the exposure period.
     */
    startTimestamp: number;

    /** * The Unix timestamp (ms) of the exact tick where the rug threshold was crossed.
     * This is the moment of impact.
     */
    endTimestamp: number;

    /** * The total number of data ticks from the buy [i] until the rug event [j].
     * A small length indicates a high-speed "Flash Rug."
     */
    length: number;

    /** * The total duration in milliseconds from entry to the crash.
     * Essential for calculating if an exit was physically possible given RPC latency.
     */
    timeMs: number;

    /** * The price percentage change at the moment the rug threshold was hit.
     * Usually a negative value (e.g., -55.00) representing the depth of the drop.
     */
    endingPriceDiffPercentage: number;
};

type PriceDiffInterval = WinInterval | RugInterval;

type PriceDiffIntervalsMap = Record<number, PriceDiffInterval>;
type ValidFiles = Record<string, PriceDiffIntervalsMap>;

export type AnalyzeMintResultsOutput = {
    processed: number;
    filesWithoutEnoughHistory: string[];
    filesWithoutHistory: string[];
    validFiles: ValidFiles;
    /** Grouped by endTimestamp to help study the lead-up context of a single event. */
    events: Record<string, Record<number, { triggerIndex: number; leadTimeMs: number; data: PriceDiffInterval }[]>>;
};

// --- CLI ---

const command = new Command();
command
    .name('analyze-mint-results')
    .description('Analyzes mint results to find winning buy points or rug pulls.')
    .version('0.2.1')
    .requiredOption('--config <string>', 'path to a config file used')
    .action(async args => {
        await runWithArgs({
            config: args.config,
        });
    });

if (require.main === module) {
    command.parse(process.argv);
}

function runWithArgs(args: { config: string; path?: string; extractTo?: string }) {
    logger.debug('Running with args %o', args);
    return analyzeMintResults(configSchema.parse(JSON.parse(fs.readFileSync(args.config).toString())));
}

// --- MAIN LOGIC ---

export async function analyzeMintResults(config: AnalyzeMintResultsConfig): Promise<AnalyzeMintResultsOutput> {
    const files = config.dataSources.reduce<FileInfo[]>((previousValue, currentValue) => {
        return previousValue.concat(getFiles(currentValue));
    }, []);

    logger.info('Started processing %d files with config=%o\n', files.length, config);

    let processed = 0;
    const filesWithoutEnoughHistory: string[] = [];
    const filesWithoutHistory: string[] = [];
    const validFiles: ValidFiles = {};
    const groupedEvents: AnalyzeMintResultsOutput['events'] = {};
    let totalEventsFound = 0;

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (!(content as HandlePumpTokenBotReport)?.history) {
            if (!config.onlyLogEvents) {
                logger.debug('[%d] Skipping file %s (No History)', processed, file.fullPath);
            }
            filesWithoutHistory.push(file.fullPath);
            processed++;
            continue;
        }

        const pc = content as HandlePumpTokenBotReport;

        if (pc.history.length < config.startFromIndex + 1) {
            if (!config.onlyLogEvents) {
                logger.debug(
                    `[%d] Skipping file %s (Too Short), history.length=${config.startFromIndex + 1}`,
                    processed,
                    file.fullPath,
                );
            }
            filesWithoutEnoughHistory.push(file.fullPath);
            processed++;
            continue;
        }

        const intervals: PriceDiffIntervalsMap = {};

        if (!config.onlyLogEvents) {
            logger.debug('[%d] Processing file %s', processed, file.fullPath);
        }

        // --- ANALYSIS LOOP ---
        for (let i = config.startFromIndex; i < pc.history.length; i++) {
            const buyEntry = pc.history[i];
            const buyPrice = buyEntry.price;

            // State for PROFIT mode tracking
            let maintenanceStartTime: number | null = null;
            let maintenanceStartIndex: number | null = null;
            let initialMaintenanceDiff: number = 0;

            // We store the "best so far" interval here.
            // This allows us to capture intervals longer than the minimum config.
            let lastValidInterval: WinInterval | null = null;

            // Loop forward in time from buy point 'i'
            for (let j = i + 1; j < pc.history.length; j++) {
                const currentEntry = pc.history[j];
                const timeElapsed = currentEntry.timestamp - buyEntry.timestamp;
                const diffPct = ((currentEntry.price - buyPrice) / buyPrice) * 100;

                // ---------------------------
                // MODE: PROFIT STRATEGY
                // ---------------------------
                if (config.mode === 'PROFIT') {
                    const safetyFloor = -config.allowedPriceDropInBetweenPercentage;

                    // 1. GLOBAL SAFETY CHECK (Running continuously)
                    // If price drops below floor at ANY point, this trade is dead.
                    if (diffPct < safetyFloor) {
                        // If we had a valid win interval captured before this crash, save it.
                        if (lastValidInterval) {
                            intervals[i] = lastValidInterval;
                        }
                        break;
                    }

                    // 2. WAIT PERIOD
                    if (timeElapsed < config.checkPriceAfterMs) {
                        continue;
                    }

                    // 3. MAINTENANCE CHECK
                    if (diffPct >= config.requiredPriceChangeDiffPercentage) {
                        if (maintenanceStartTime === null) {
                            maintenanceStartTime = currentEntry.timestamp;
                            maintenanceStartIndex = j;
                            initialMaintenanceDiff = diffPct;
                        }

                        const durationHeld = currentEntry.timestamp - maintenanceStartTime;

                        // GREEDY LOGIC:
                        // If we meet the minimum requirement, we update the "best known interval".
                        // We DO NOT break here; we keep looping to see if it holds longer.
                        if (durationHeld >= config.requiredMaintainIncreaseMs) {
                            lastValidInterval = {
                                type: 'WIN',
                                startTimestamp: buyEntry.timestamp,
                                endTimestamp: currentEntry.timestamp,
                                length: j - i,
                                timeMs: timeElapsed,
                                maintainedLength: j - (maintenanceStartIndex ?? j),
                                maintainedTimeMs: durationHeld,
                                startingPriceDiffPercentage: initialMaintenanceDiff,
                                endingPriceDiffPercentage: diffPct,
                            };
                        }
                    } else {
                        // Price dipped below target (but above safety floor).
                        // If we already secured a WIN, save the longest valid run we found and stop.
                        if (lastValidInterval) {
                            intervals[i] = lastValidInterval;
                            break;
                        }

                        // Otherwise, reset maintenance timer and keep looking for a new recovery.
                        maintenanceStartTime = null;
                        maintenanceStartIndex = null;
                        initialMaintenanceDiff = 0;
                    }

                    // 4. END OF HISTORY CHECK
                    // If we reach the end of the file and have a valid interval pending, save it.
                    if (j === pc.history.length - 1 && lastValidInterval) {
                        intervals[i] = lastValidInterval;
                    }
                }

                // ---------------------------
                // MODE: RUG STRATEGY
                // ---------------------------
                else if (config.mode === 'RUG') {
                    // Check if rug happened within the allowed window
                    if (timeElapsed > config.checkPriceAfterMs) {
                        break; // Too slow, not a "quick rug"
                    }

                    const rugThreshold = -config.rugThresholdPercentage;

                    if (diffPct <= rugThreshold) {
                        // RUG DETECTED
                        intervals[i] = {
                            type: 'RUG',
                            startTimestamp: buyEntry.timestamp,
                            endTimestamp: currentEntry.timestamp,
                            length: j - i,
                            timeMs: timeElapsed,
                            endingPriceDiffPercentage: diffPct,
                        };
                        break; // Found the rug point
                    }
                }
            }
        }

        const eventCount = Object.keys(intervals).length;
        if (eventCount > 0) {
            validFiles[file.fullPath] = intervals;
            totalEventsFound += eventCount;

            // --- GROUPING LOGIC FOR CONTEXT STUDY ---
            groupedEvents[file.fullPath] = {};
            for (const [idx, data] of Object.entries(intervals)) {
                const eventEnd = data.endTimestamp;
                if (!groupedEvents[file.fullPath][eventEnd]) {
                    groupedEvents[file.fullPath][eventEnd] = [];
                }
                groupedEvents[file.fullPath][eventEnd].push({
                    triggerIndex: Number(idx),
                    leadTimeMs: eventEnd - data.startTimestamp,
                    data,
                });
            }

            logger.debug('[%d] Found %d %s events in %s', processed, eventCount, config.mode, file.fullPath);
        } else if (!config.onlyLogEvents) {
            logger.debug('[%d] No events found in %s', processed, file.fullPath);
        }

        processed++;
    }

    logger.info('------------------------------------------------');
    logger.info('Processing Complete');
    logger.info(`Mode: ${config.mode}`);
    logger.info(`Files Processed: ${processed}`);
    logger.info(`Valid Files (with events): ${Object.keys(validFiles).length}`);
    logger.info(`Total Events Found: ${totalEventsFound}`);
    logger.info('------------------------------------------------');

    const result: AnalyzeMintResultsOutput = {
        processed: processed,
        filesWithoutEnoughHistory: filesWithoutEnoughHistory,
        filesWithoutHistory: filesWithoutHistory,
        validFiles: validFiles,
        events: groupedEvents,
    };

    if (config.reportPath) {
        logger.info('Writing results to %s', config.reportPath);
        fs.writeFileSync(config.reportPath, JSON.stringify(result, null, 2));
    }

    return result;
}
