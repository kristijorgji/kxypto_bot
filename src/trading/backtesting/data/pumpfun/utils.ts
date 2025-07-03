import fs from 'fs';

import { logger } from '@src/logger';
import {
    BotTradeResponse,
    HandlePumpTokenBotReport,
    HandlePumpTokenExitReport,
    HandlePumpTokenReport,
} from '@src/trading/bots/blockchains/solana/types';
import { comparePaths, moveFile, walkDirFilesSyncRecursive } from '@src/utils/files';
import { formDataFolder } from '@src/utils/storage';

import { ExitMonitoringReason } from '../../../bots/types';

export function formPumpfunBacktestStatsDir(): string {
    return formDataFolder('pumpfun-stats/backtest');
}

type ModeStats = {
    trade?: {
        wins?: number;
        losses?: number;
    };
    noTrade?: Record<string, number>;
    exit?: Record<string, number>;
};

type Stats = {
    simulation: ModeStats;
    real: ModeStats;
};

export async function organizePumpfunFiles(args: { path: string; dryRun: boolean }) {
    const config = {
        path: args.path,
        dryRun: args.dryRun,
    };

    logger.info('Started with config=%o\n', config);

    const files = walkDirFilesSyncRecursive(config.path, [], 'json');
    let skipped = 0;
    let changed = 0;
    let unchanged = 0;

    const allModesFinalStats: Stats = {
        real: {},
        simulation: {},
    };
    const allModesChangedStats: Stats = {
        real: {},
        simulation: {},
    };

    logger.info('Will process %d files', files.length);

    for (const file of files) {
        let content: HandlePumpTokenReport;
        try {
            content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;
        } catch (_) {
            throw new Error(`Error reading and parsing file ${file.fullPath}`);
        }

        // skip older files that don't have a supported schema
        if (content.$schema === undefined) {
            skipped++;
            continue;
        }

        const mode = content.simulation ? 'simulation' : 'real';
        const finalModeStats = allModesFinalStats[mode];
        const changedModeStats = allModesChangedStats[mode];
        let pendingChange: (() => void) | undefined;

        let path = `${config.path}/${mode}/${content.$schema.version}`;
        if ((content as HandlePumpTokenBotReport).strategy) {
            const c = content as HandlePumpTokenBotReport;
            path = `${path}/${c.strategy.name}/${c.strategy.configVariant === '' ? '_' : c.strategy.configVariant}`;
        } else {
            const exitCode = (content as HandlePumpTokenExitReport).exitCode.toLowerCase();
            path = `${path}/_exit_/${exitCode}/${file.name}`;

            const tmp = {
                key: 'exit' satisfies keyof ModeStats as keyof ModeStats,
                subKey: exitCode,
            };
            incrementInFrequencyMap(finalModeStats, tmp);
            pendingChange = () => incrementInFrequencyMap(changedModeStats, tmp);
        }

        if ((content as BotTradeResponse).netPnl) {
            const tradeType = (content as BotTradeResponse).netPnl.inLamports > 0 ? 'wins' : 'losses';
            path = `${path}/trade/${tradeType}/${file.name}`;

            const tmp = {
                key: 'trade' satisfies keyof ModeStats as keyof ModeStats,
                subKey: tradeType,
            };
            incrementInFrequencyMap(finalModeStats, tmp);
            pendingChange = () => incrementInFrequencyMap(changedModeStats, tmp);
        }

        if (
            (content as HandlePumpTokenBotReport).strategy &&
            Object.prototype.hasOwnProperty.call(content, 'exitCode')
        ) {
            const exitCode = (content as { exitCode: ExitMonitoringReason }).exitCode.toLowerCase();
            path = `${path}/no_trade/${exitCode}/${file.name}`;

            const tmp = {
                key: 'noTrade' satisfies keyof ModeStats as keyof ModeStats,
                subKey: exitCode,
            };
            incrementInFrequencyMap(finalModeStats, tmp);
            pendingChange = () => incrementInFrequencyMap(changedModeStats, tmp);
        }

        if (!comparePaths(path, file.fullPath)) {
            logger.info('%sMoving file from %s to %s', config.dryRun ? '[dryRun] ' : '', file.fullPath, path);
            if (!config.dryRun) {
                await moveFile(file.fullPath, path);
            }
            pendingChange && pendingChange();
            changed++;
        } else {
            unchanged++;
        }
    }

    logger.info('%d files were moved in the proper place', changed);
    logger.info('%d files were in the proper place and not moved', unchanged);
    logger.info('%d files were skipped because had not supported json structure', skipped);
    logger.info('Changed stats=%o', allModesChangedStats);
    logger.info('Final stats=%o', allModesFinalStats);
}

function incrementInFrequencyMap<T extends Record<string, Record<string, number>>>(
    map: T,
    {
        key,
        subKey,
    }: {
        key: keyof T;
        subKey: string;
    },
): void {
    if (!map[key]) {
        // @ts-ignore
        map[key] = {};
    }
    if (!map[key][subKey]) {
        // @ts-ignore
        map[key][subKey] = 0;
    }
    // @ts-ignore
    map[key][subKey]++;
}
