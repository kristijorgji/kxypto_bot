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

export async function organizePumpfunFiles(args: { path: string }) {
    const config = {
        path: args.path,
    };

    logger.info('Started with config=%o\n', config);

    const files = walkDirFilesSyncRecursive(config.path, [], 'json');
    let skipped = 0;
    let changed = 0;
    let unchanged = 0;

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

        let path = `${config.path}/${content.simulation ? 'simulation' : 'real'}/${content.$schema.version}`;
        if ((content as HandlePumpTokenBotReport).strategy) {
            const c = content as HandlePumpTokenBotReport;
            path = `${path}/${c.strategy.name}/${c.strategy.configVariant === '' ? '_' : c.strategy.configVariant}`;
        } else {
            path = `${path}/_exit_/${(content as HandlePumpTokenExitReport).exitCode.toLowerCase()}/${file.name}`;
        }

        if ((content as BotTradeResponse).netPnl) {
            const tradeType = (content as BotTradeResponse).netPnl.inLamports > 0 ? 'wins' : 'losses';
            path = `${path}/trade/${tradeType}/${file.name}`;
        }

        if (
            (content as HandlePumpTokenBotReport).strategy &&
            Object.prototype.hasOwnProperty.call(content, 'exitCode')
        ) {
            path = `${path}/no_trade/${(content as { exitCode: ExitMonitoringReason }).exitCode.toLowerCase()}/${
                file.name
            }`;
        }

        if (!comparePaths(path, file.fullPath)) {
            logger.info('Moving file from %s to %s', file.fullPath, path);
            await moveFile(file.fullPath, path);
            changed++;
        } else {
            unchanged++;
        }
    }

    logger.info('%d files were moved in the proper place', changed);
    logger.info('%d files were in the proper place and not moved', unchanged);
    logger.info('%d files were skipped because had not supported json structure', skipped);
}
