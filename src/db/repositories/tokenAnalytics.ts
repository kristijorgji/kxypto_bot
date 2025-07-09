import { ExitMonitoringReason } from '@src/trading/bots/types';

import { db } from '../knex';
import { Tables } from '../tables';
import { CreatedOnPumpfun } from './PumpfunRepository';

export type GetTokenCreatorStatsResult = {
    createdCount: number;
    results: {
        count: number;
        exit_code: ExitMonitoringReason | null;
    }[];
};

export async function getTokenCreatorStats(
    chain: 'solana',
    platform: 'pumpfun',
    creator: string,
): Promise<GetTokenCreatorStatsResult> {
    if (platform !== 'pumpfun') {
        throw new Error(`Unknown platform ${platform}`);
    }

    const query = `
        (SELECT 'createdCount' as type, COUNT(*) as count, NULL as exit_code
         FROM ??
         WHERE chain = ? AND createdOn = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(other, '$.creator')) = ?)
        UNION ALL
        (SELECT 'exitCount' as type, COUNT(*) as count, exit_code
         FROM ??
         WHERE chain = ? AND platform = ? AND creator = ?
         GROUP BY exit_code)
    `;

    const bindings = [
        Tables.Tokens,
        chain,
        CreatedOnPumpfun,
        creator,
        Tables.LaunchpadTokenResults,
        chain,
        platform,
        creator,
    ];

    const results = await db.raw(query, bindings);
    const rows = results[0] || results;

    const createdCount = rows.find((r: { type: string }) => r.type === 'createdCount')?.count || 0;
    const exitResults = rows
        .filter((r: { type: string }) => r.type === 'exitCount')
        .map((r: { count: number; exit_code: ExitMonitoringReason | null }) => ({
            count: r.count,
            exit_code: r.exit_code,
        }));

    return {
        createdCount,
        results: exitResults,
    };
}
