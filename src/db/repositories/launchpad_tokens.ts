import { db } from '@src/db/knex';
import { Tables } from '@src/db/tables';
import { Blockchain, LaunchpadTokenReport, LaunchpadTokenResult } from '@src/db/types';
import CompositeCursor from '@src/db/utils/CompositeCursor';
import { applyCompositeCursorFilter, scopedColumn } from '@src/db/utils/queries';
import { HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { ExitMonitoringReason, Mode } from '@src/trading/bots/types';

export async function insertLaunchpadTokenResult(
    data: Omit<LaunchpadTokenResult, 'id' | 'created_at' | 'updated_at'>,
    report: HandlePumpTokenReport,
): Promise<void> {
    await db.transaction(async trx => {
        const [launchpadTokenResultId] = (await trx(Tables.LaunchpadTokenResults).insert(data)) as [number];
        await trx(Tables.LaunchpadTokenReports).insert({
            launchpad_token_result_id: launchpadTokenResultId,
            schema_version: report.$schema.version,
            report: report,
        } satisfies Omit<LaunchpadTokenReport, 'id' | 'created_at' | 'updated_at'>);
    });
}

export interface LaunchpadTokenFullResult<R = Record<string, unknown>> {
    id: number;
    simulation: boolean;
    chain: Blockchain;
    platform: LaunchpadTokenResult['platform'];
    mint: string;
    creator: string;
    report: R;
    net_pnl: number;
    exit_code: string | null;
    exit_reason: string | null;
    created_at: Date;
    updated_at: Date;
}

export async function getLaunchpadTokenFullResult<R>(p: {
    mode: Mode | undefined;
    chain: Blockchain;
    platform: LaunchpadTokenResult['platform'] | undefined;
    minSchemaVersion: number | undefined;
    tradesOnly: boolean;
    exitCodes: ExitMonitoringReason[];
    excludeExitCodes: ExitMonitoringReason[];
    includeTrades: boolean;
    direction: 'asc' | 'desc';
    limit: number;
    cursor?: CompositeCursor;
}): Promise<LaunchpadTokenFullResult<R>[]> {
    const queryBuilder = db
        .table(Tables.LaunchpadTokenResults)
        .select<LaunchpadTokenFullResult<R>[]>([
            'launchpad_token_results.id',
            'simulation',
            'chain',
            'platform',
            'mint',
            'creator',
            'report',
            'net_pnl',
            'exit_code',
            'exit_reason',
            'launchpad_token_results.created_at',
            'launchpad_token_results.updated_at',
        ])
        .join(
            Tables.LaunchpadTokenReports,
            scopedColumn(Tables.LaunchpadTokenResults, 'id'),
            scopedColumn(Tables.LaunchpadTokenReports, 'launchpad_token_result_id'),
        )
        .where({
            chain: p.chain,
        } satisfies Partial<LaunchpadTokenResult>)
        .orderBy([
            { column: scopedColumn(Tables.LaunchpadTokenResults, 'created_at'), order: p.direction },
            { column: scopedColumn(Tables.LaunchpadTokenResults, 'id'), order: p.direction },
        ])
        .limit(p.limit);

    if (p.mode) {
        queryBuilder.where('simulation', p.mode === 'simulation' ? 1 : 0);
    }

    if (p.platform) {
        queryBuilder.where('platform', p.platform);
    }

    if (p.minSchemaVersion) {
        queryBuilder.where('schema_version', '>=', p.minSchemaVersion);
    }

    if (p.tradesOnly) {
        queryBuilder.whereNotNull('net_pnl');
    } else if (p.includeTrades) {
        queryBuilder.where(function () {
            this.whereNotNull('net_pnl');

            this.orWhere(function () {
                if (p.exitCodes.length > 0) {
                    this.whereIn('exit_code', p.exitCodes);
                }

                if (p.excludeExitCodes.length > 0) {
                    this.whereNotIn('exit_code', p.excludeExitCodes);
                }
            });
        });
    } else {
        if (p.exitCodes.length > 0) {
            queryBuilder.whereIn('exit_code', p.exitCodes);
        }

        if (p.excludeExitCodes.length > 0) {
            queryBuilder.whereNotIn('exit_code', p.excludeExitCodes);
        }
    }

    if (p.cursor) {
        applyCompositeCursorFilter(queryBuilder, p.cursor, Tables.LaunchpadTokenResults, p.direction);
    }

    return (await queryBuilder).map(e => ({
        ...e,
        // @ts-ignore
        simulation: e.simulation === 1,
    }));
}
