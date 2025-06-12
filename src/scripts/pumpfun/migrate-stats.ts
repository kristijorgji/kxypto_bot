import fs from 'fs';

import { logger } from '@src/logger';
import { formPumpfunStatsDataFolder, organizePumpfunFiles } from '@src/trading/backtesting/data/pumpfun/utils';
import { insertKeysAfter } from '@src/utils/data/records';
import { walkDirFilesSyncRecursive } from '@src/utils/files';
import { getSecondsDifference } from '@src/utils/time';

import { HandlePumpTokenReport } from './bot';

(async () => {
    await start();
})();

/**
 * It will migrate pumpfun files from old schema to new ones when supported
 */
async function start() {
    await migrateFilesToNewSchema();
}

async function migrateFilesToNewSchema() {
    const pumpfunStatsPath = formPumpfunStatsDataFolder();
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json');
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

        if (content.$schema.version === 1.05) {
            content.$schema.version = 1.06;
            const updated = insertKeysAfter(content, {
                endedAt: {
                    elapsedSeconds: getSecondsDifference(new Date(content.startedAt), new Date(content.endedAt)),
                    monitor: {
                        buyTimeframeMs: 500,
                        sellTimeframeMs: 200,
                    },
                },
            }) as unknown as HandlePumpTokenReport;
            changed++;
            logger.info('Updating file %s in-place', file.fullPath);
            fs.writeFileSync(file.fullPath, JSON.stringify(updated, null, 2));
        } else {
            unchanged++;
        }
    }

    logger.info('%d files were updated in-place', changed);
    logger.info('%d files were in the proper place and not moved', unchanged);
    logger.info('%d files were skipped because had not supported json structure', skipped);

    if (changed > 0) {
        logger.info('Will re-organize the folders now');
        await organizePumpfunFiles({
            path: formPumpfunStatsDataFolder(),
        });
    }
}
