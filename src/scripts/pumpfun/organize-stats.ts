import fs from 'fs';

import { HandlePumpTokenReport } from './bot';
import { logger } from '../../logger';
import { BotTradeResponse } from '../../trading/bots/blockchains/solana/types';
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
    let skipped = 0;
    let changed = 0;
    let unchanged = 0;

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        // skip older files that don't have a supported schema
        if (content.$schema === undefined) {
            skipped++;
            continue;
        }

        let path = `${pumpfunStatsPath}/${content.simulation ? 'simulation' : 'real'}/${content.$schema.version}`;
        path = `${path}/${content.strategy.name}/${
            content.strategy.configVariant === '' ? '_' : content.strategy.configVariant
        }`;

        if ((content as BotTradeResponse).netPnl) {
            const tradeType = (content as BotTradeResponse).netPnl.inLamports > 0 ? 'wins' : 'losses';
            path = `${path}/trade/${tradeType}/${file.name}`;
        }

        if (Object.prototype.hasOwnProperty.call(content, 'exitCode')) {
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
