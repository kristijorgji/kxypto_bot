import fs from 'fs';

import { HandlePumpTokenReport } from './bot';
import { logger } from '../../logger';
import { BotTradeResponse, SolanaValue } from '../../trading/bots/blockchains/solana/types';
import { ExitMonitoringReason } from '../../trading/bots/types';
import { comparePaths, moveFile, walkDirFilesSyncRecursive } from '../../utils/files';
import { formDataFolder } from '../../utils/storage';

(async () => {
    await start();
})();

/**
 * It will organize the files under `./data/pumpfun-stats`
 * and move them into proper folders based on the handling result
 * if it was a trade, win, loss or exit for a particular reason
 */
async function start() {
    await organizeFiles();
}

async function organizeFiles() {
    const pumpfunStatsPath = formDataFolder('pumpfun-stats');
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath);
    let changed = 0;
    let unchanged = 0;

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        const simulation = content.simulation ?? true;
        const dir = `${pumpfunStatsPath}/${simulation ? 'simulation' : 'real'}`;

        const schemaVersion = content?.schemaVersion;
        let schemaVersionedDir = dir;
        if (schemaVersion) {
            schemaVersionedDir = `${dir}/${schemaVersion}`;
        }

        const strategy = content?.strategy ?? 'no_strategy';
        if (strategy) {
            schemaVersionedDir = `${schemaVersionedDir}/${strategy}`;
        }

        let newPath = `${schemaVersionedDir}/${file.name}`;

        /**
         * Trade recognition and categorization for schema version < 1.04
         * TODO: Remove this once we delete older history data and keep only the new ones
         */
        if (Object.prototype.hasOwnProperty.call(content, 'trade')) {
            const tradeType =
                (
                    content as unknown as {
                        trade: {
                            netPnl: SolanaValue;
                        };
                    }
                ).trade.netPnl.inLamports > 0
                    ? 'wins'
                    : 'losses';
            newPath = `${schemaVersionedDir}/trade/${tradeType}/${file.name}`;
        }
        /**
         * Trade recognition and categorization for schema version >= 1.04
         */
        if ((content as BotTradeResponse).netPnl) {
            const tradeType = (content as BotTradeResponse).netPnl.inLamports > 0 ? 'wins' : 'losses';
            newPath = `${schemaVersionedDir}/trade/${tradeType}/${file.name}`;
        }

        if (Object.prototype.hasOwnProperty.call(content, 'exitCode')) {
            newPath = `${schemaVersionedDir}/no_trade/${(
                content as { exitCode: ExitMonitoringReason }
            ).exitCode.toLowerCase()}/${file.name}`;
        }

        if (!comparePaths(newPath, file.fullPath)) {
            logger.info('Moving file from %s to %s', file.fullPath, newPath);
            await moveFile(file.fullPath, newPath);
            changed++;
        } else {
            unchanged++;
        }
    }

    logger.info('%d files were moved in the proper place', changed);
    logger.info('%d files were in the proper place and not moved', unchanged);
}
