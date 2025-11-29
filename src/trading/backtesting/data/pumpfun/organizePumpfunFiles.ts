import fs from 'fs';

import { logger } from '@src/logger';
import {
    BotTradeResponse,
    HandlePumpTokenBotReport,
    HandlePumpTokenExitReport,
    HandlePumpTokenReport,
} from '@src/trading/bots/blockchains/solana/types';
import { ExitMonitoringReason } from '@src/trading/bots/types';
import { comparePaths, moveFile, walkDirFilesSyncRecursive } from '@src/utils/files';

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

        const drpr = determineReportPath(file.name, content, config.path);
        if ((drpr as { skipReason?: string }).skipReason) {
            skipped++;
            continue;
        }
        const sr = drpr as DetermineReportPathSuccess;
        const mode = content.simulation ? 'simulation' : 'real';

        const finalModeStats = allModesFinalStats[mode];
        const changedModeStats = allModesChangedStats[mode];
        let pendingChange: (() => void) | undefined;

        incrementInFrequencyMap(finalModeStats, sr.moveCategory);
        pendingChange = () => incrementInFrequencyMap(changedModeStats, sr.moveCategory);

        if (!comparePaths(sr.destFullPath, file.fullPath)) {
            logger.info(
                '%sMoving file from %s to %s',
                config.dryRun ? '[dryRun] ' : '',
                file.fullPath,
                sr.destFullPath,
            );
            if (!config.dryRun) {
                await moveFile(file.fullPath, sr.destFullPath);
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

export type DetermineReportPathSuccess = {
    destFullPath: string;
    moveCategory: {
        key: keyof ModeStats;
        subKey: string;
    };
};

export function determineReportPath(
    fileName: string,
    content: HandlePumpTokenReport,
    destDir: string,
):
    | DetermineReportPathSuccess
    | {
          skipReason: string;
      } {
    // skip older files that don't have a supported schema
    if (content.$schema === undefined) {
        return {
            skipReason: 'missing $schema',
        };
    }

    let moveCategory: DetermineReportPathSuccess['moveCategory'];
    const mode = content.simulation ? 'simulation' : 'real';

    let path = `${destDir}/${mode}/${content.$schema.version}`;

    if ((content as HandlePumpTokenBotReport).strategy) {
        const c = content as HandlePumpTokenBotReport;

        const sanitizedConfigVariant =
            c.strategy.configVariant === '' ? '_' : c.strategy.configVariant.replace(/[\\/]/g, '_');
        path = `${path}/${c.strategy.name}/${sanitizedConfigVariant}`;
    } else {
        const exitCode = (content as HandlePumpTokenExitReport).exitCode.toLowerCase();
        path = `${path}/_exit_/${exitCode}/${fileName}`;

        moveCategory = {
            key: 'exit' satisfies keyof ModeStats as keyof ModeStats,
            subKey: exitCode,
        };
    }

    if ((content as BotTradeResponse).netPnl) {
        const tradeType = (content as BotTradeResponse).netPnl.inLamports > 0 ? 'wins' : 'losses';
        path = `${path}/trade/${tradeType}/${fileName}`;

        moveCategory = {
            key: 'trade' satisfies keyof ModeStats as keyof ModeStats,
            subKey: tradeType,
        };
    }

    if ((content as HandlePumpTokenBotReport).strategy && Object.prototype.hasOwnProperty.call(content, 'exitCode')) {
        const exitCode = (content as { exitCode: ExitMonitoringReason }).exitCode.toLowerCase();
        path = `${path}/no_trade/${exitCode}/${fileName}`;

        moveCategory = {
            key: 'noTrade' satisfies keyof ModeStats as keyof ModeStats,
            subKey: exitCode,
        };
    }

    return {
        destFullPath: path,
        moveCategory: moveCategory!,
    };
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
