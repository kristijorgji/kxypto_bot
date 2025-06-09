import fs from 'fs';

import { db } from '@src/db/knex';
import { Tables } from '@src/db/tables';
import { LaunchpadTokenResult } from '@src/db/types';
import { logger } from '@src/logger';
import { formPumpfunStatsDataFolder } from '@src/trading/backtesting/data/pumpfun/utils';
import { BotExitResponse, BotTradeResponse } from '@src/trading/bots/blockchains/solana/types';
import { walkDirFilesSyncRecursive } from '@src/utils/files';

import { HandlePumpTokenReport } from './bot';

(async () => {
    start().finally(() => {
        db.destroy();
    });
})();

/**
 * It will insert entries into launchpad_token_results db table for every result file if they are missing
 */
async function start() {
    await migrateFilesToDb();
}

async function migrateFilesToDb() {
    const pumpfunStatsPath = formPumpfunStatsDataFolder();
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json');

    const chain = 'solana';
    const platform = 'pumpfun';

    let skipped = 0;
    let inserted = 0;
    let alreadyInserted = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        let content: HandlePumpTokenReport;
        try {
            content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;
        } catch (_) {
            throw new Error(`Error reading and parsing file ${file.fullPath}`);
        }

        if (content.creator === undefined) {
            logger.info('[%d] [skipping] file %s has not supported schema and missing creator field', i, file.fullPath);
            skipped++;
            continue;
        }

        const startedAt = new Date(content.startedAt);

        const existingEntry = await db
            .table(Tables.LaunchpadTokenResults)
            .select<LaunchpadTokenResult>()
            .where({
                chain: chain,
                platform: platform,
                mint: content.mint,
            })
            .first();

        if (existingEntry) {
            alreadyInserted++;

            const bufferMs = (content.elapsedSeconds + 2) * 1000;
            const createdAt = (existingEntry as unknown as { created_at: Date }).created_at.getTime();
            if (createdAt >= startedAt.getTime() - bufferMs && createdAt <= startedAt.getTime() + bufferMs) {
                logger.info('[%d] [skipping] file %s is already inserted', i, file.fullPath);
            } else {
                logger.info(
                    '[%d] [CAREFUL] file %s exist but with different more than %ss diff in creation time, diff %s',
                    i,
                    file.fullPath,
                    bufferMs / 1000,
                    (createdAt - startedAt.getTime()) / 1000,
                );
            }
        } else {
            try {
                await db(Tables.LaunchpadTokenResults).insert({
                    simulation: content.simulation,
                    chain: chain,
                    platform: platform,
                    mint: content.mint,
                    creator: content.creator,
                    net_pnl: (content as BotTradeResponse)?.netPnl?.inSol ?? null,
                    exit_code: (content as BotExitResponse)?.exitCode ?? null,
                    exit_reason: (content as BotExitResponse)?.exitReason ?? null,
                    created_at: startedAt,
                });
                inserted++;
                logger.info('[%d] [inserted] file %s result into db', i, file.fullPath);
            } catch (e) {
                logger.error('[%d] error inserting file %s', i, file.fullPath);
                logger.error(e);
            }
        }
    }

    logger.info('%d files inserted into %s db', inserted, Tables.LaunchpadTokenResults);
    logger.info('%d files were skipped because were already inserted', alreadyInserted);
    logger.info('%d files were skipped because had unsupported schema version', skipped);
}
