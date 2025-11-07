import { lamportsToSol } from '@src/blockchains/utils/amount';
import { CommonTradeFilters, applyCommonTradeFilters } from '@src/db/repositories/launchpad_tokens';
import { CompositeCursorPaginationParams } from '@src/db/repositories/types';
import fetchCursorPaginatedData from '@src/db/utils/fetchCursorPaginatedData';
import { applyCompositeCursorFilter, scopedColumn } from '@src/db/utils/queries';
import { CursorPaginatedResponse } from '@src/http-api/types';
import {
    ProtoBacktestMintFullResult,
    ProtoBacktestRun,
    ProtoBacktestStrategyFullResult,
} from '@src/protos/generated/backtests';
import { normalizeOptionalFields, normalizeOptionalFieldsInArray } from '@src/protos/mappers/normalizeOptionalFields';
import {
    BacktestExitResponse,
    BacktestTradeResponse,
    StrategyBacktestResult,
    StrategyMintBacktestResult,
} from '@src/trading/bots/blockchains/solana/types';
import { RequestDataParams } from '@src/ws-api/types';

import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import { db } from '../knex';
import { Tables } from '../tables';
import {
    Backtest,
    BacktestRun,
    BacktestStrategyMintResult,
    BacktestStrategyResult,
    Blockchain,
    ProcessingStatus,
} from '../types';

export async function getBacktestById(id: string): Promise<Backtest> {
    const r = await db.table(Tables.Backtests).select<Backtest>().where('id', id).first();
    if (!r) {
        throw new Error(`Backtest with id ${id} was not found`);
    }

    return r;
}

async function getBacktest(chain: Blockchain, name: string): Promise<Backtest> {
    const r = await db.table(Tables.Backtests).select<Backtest>().where('chain', chain).where('name', name).first();
    if (!r) {
        throw new Error(`Backtest with for chain ${chain} and name ${name} was not found`);
    }

    return r;
}

export async function storeBacktest(backtest: Backtest) {
    await db.table(Tables.Backtests).insert({
        id: backtest.id,
        config: backtest.config,
    });
}

export async function createBacktestRun(
    data: Omit<BacktestRun, 'id' | 'finished_at' | 'created_at' | 'updated_at'>,
): Promise<ProtoBacktestRun> {
    const now = new Date();

    const draftInsert: Omit<BacktestRun, 'id'> = {
        ...data,
        started_at: now,
        finished_at: null,
        created_at: now,
        updated_at: now,
    };

    const [id] = (await db.table(Tables.BacktestRuns).insert(draftInsert)) as [number];

    return normalizeOptionalFields(
        {
            id: id,
            ...draftInsert,
        },
        ['user_id', 'api_client_id', 'finished_at'],
    ) as ProtoBacktestRun;
}

export function getBacktestRuns(p: CompositeCursorPaginationParams, _: {}): Promise<BacktestRun[]> {
    const queryBuilder = db
        .table(Tables.BacktestRuns)
        .select()
        .orderBy([
            { column: 'created_at', order: p.direction },
            { column: 'id', order: p.direction },
        ])
        .limit(p.limit);

    if (p.cursor) {
        applyCompositeCursorFilter(queryBuilder, p.cursor, '', p.direction);
    }

    return queryBuilder;
}

type PartialBacktestRunUpdateResponse = Pick<ProtoBacktestRun, 'status' | 'finished_at'>;

export async function markBacktestRunCompleted(id: number): Promise<PartialBacktestRunUpdateResponse> {
    const update: PartialBacktestRunUpdateResponse = {
        status: ProcessingStatus.Completed,
        finished_at: new Date(),
    } satisfies Pick<BacktestRun, 'status' | 'finished_at'>;

    await db.table(Tables.BacktestRuns).where('id', id).update(update);

    return normalizeOptionalFields(update, ['finished_at']);
}

export async function initBacktestStrategyResult(
    backtestId: string,
    backtestRunId: number,
    strategy: LaunchpadBotStrategy,
    status: ProcessingStatus.Pending | ProcessingStatus.Running,
): Promise<BacktestStrategyResult> {
    const now = new Date();

    const draftInsert: Omit<BacktestStrategyResult, 'id'> = {
        backtest_id: backtestId,
        backtest_run_id: backtestRunId,
        status: status,
        strategy: strategy.name,
        strategy_id: strategy.identifier,
        config_variant: strategy.configVariant,
        config: strategy.config,
        pnl_sol: 0,
        holdings_value_sol: 0,
        roi: 0,
        win_rate: 0,
        wins_count: 0,
        biggest_win_percentage: 0,
        losses_count: 0,
        biggest_loss_percentage: 0,
        total_trades_count: 0,
        buy_trades_count: 0,
        sell_trades_count: 0,
        highest_peak_sol: 0,
        lowest_trough_sol: 0,
        max_drawdown_percentage: 0,
        execution_time_seconds: 0,
        created_at: now,
        updated_at: now,
    };
    const [strategyResultId] = (await db(Tables.BacktestStrategyResults).insert(draftInsert)) as [number];

    return {
        id: strategyResultId,
        ...draftInsert,
    };
}

type PartialBacktestStrategyResultUpdateResponse = Omit<
    BacktestStrategyResult,
    | 'id'
    | 'backtest_id'
    | 'backtest_run_id'
    | 'strategy'
    | 'strategy_id'
    | 'config_variant'
    | 'config'
    | 'created_at'
    | 'updated_at'
>;

export async function completeBacktestStrategyResult(
    strategyResultId: number,
    sr: StrategyBacktestResult,
    executionTimeSeconds: number,
): Promise<PartialBacktestStrategyResultUpdateResponse> {
    return await db.transaction<PartialBacktestStrategyResultUpdateResponse>(async trx => {
        const update: PartialBacktestStrategyResultUpdateResponse = {
            status: ProcessingStatus.Completed,
            pnl_sol: sr.totalPnlInSol,
            holdings_value_sol: sr.totalHoldingsValueInSol,
            roi: sr.totalRoi,
            win_rate: sr.winRatePercentage,
            wins_count: sr.winsCount,
            biggest_win_percentage: sr.biggestWinPercentage,
            losses_count: sr.lossesCount,
            biggest_loss_percentage: sr.biggestLossPercentage,
            total_trades_count: sr.totalTradesCount,
            buy_trades_count: sr.totalBuyTradesCount,
            sell_trades_count: sr.totalSellTradesCount,
            highest_peak_sol: lamportsToSol(sr.highestPeakLamports),
            lowest_trough_sol: lamportsToSol(sr.lowestTroughLamports),
            max_drawdown_percentage: sr.maxDrawdownPercentage,
            execution_time_seconds: executionTimeSeconds,
        };
        await trx(Tables.BacktestStrategyResults).where('id', strategyResultId).update(update);

        await trx(Tables.BacktestStrategyMintResults).insert(
            Object.values(sr.mintResults).map(bmr => formDraftMintResultFromBacktestMintResult(strategyResultId, bmr)),
        );

        return update;
    });
}

export async function getBacktestStrategyResults(
    backtestId: string,
    params?: {
        orderBy?: {
            columnName: 'pnl_sol';
            order: 'asc' | 'desc';
        };
        limit?: number;
    },
): Promise<BacktestStrategyResult[]> {
    let query = db
        .table(Tables.BacktestStrategyResults)
        .select<BacktestStrategyResult[]>()
        .where('backtest_id', backtestId);

    if (params?.orderBy) {
        query = query.orderBy(params.orderBy.columnName, params.orderBy.order);
    }

    if (params?.limit) {
        query = query.limit(params.limit);
    }

    return (await query) as BacktestStrategyResult[];
}

export type BacktestStrategyFullResult = Omit<ProtoBacktestStrategyFullResult, 'created_at'> & {
    created_at: Date;
};

export type BacktestsStrategyResultsFilters = {
    chain: Blockchain;
    backtestId?: string;
    backtestName?: string;
    strategyId?: string;
    strategyName?: string;
    strategyConfigVariant?: string;
};

async function getBacktestsStrategyResults(
    p: CompositeCursorPaginationParams,
    f: BacktestsStrategyResultsFilters,
): Promise<BacktestStrategyFullResult[]> {
    let backtests: Backtest[] | undefined;

    if (f.backtestId) {
        backtests = [await getBacktestById(f.backtestId)];
    } else if (f.backtestName) {
        backtests = [await getBacktest(f.chain, f.backtestName)];
    } else if (f.chain) {
        backtests = await db.table(Tables.Backtests).select<Backtest[]>().where('chain', f.chain);
    }

    const queryBuilder = db
        .table(Tables.BacktestStrategyResults)
        .select()
        .orderBy([
            { column: 'created_at', order: p.direction },
            { column: 'id', order: p.direction },
        ])
        .limit(p.limit);

    if (backtests) {
        queryBuilder.whereIn(
            'backtest_id',
            backtests.map(el => el.id),
        );
    }

    if (f.strategyId) {
        queryBuilder.where('strategy_id', f.strategyId);
    }

    if (f.strategyName) {
        queryBuilder.where('strategy', f.strategyName);
    }

    if (f.strategyConfigVariant) {
        queryBuilder.where('config_variant', f.strategyConfigVariant);
    }

    if (p.cursor) {
        applyCompositeCursorFilter(queryBuilder, p.cursor, '', p.direction);
    }

    return queryBuilder;
}

export async function fetchBacktestsStrategyResultsCursorPaginated(
    params: RequestDataParams<BacktestsStrategyResultsFilters>,
): Promise<CursorPaginatedResponse<BacktestStrategyFullResult>> {
    return fetchCursorPaginatedData(getBacktestsStrategyResults, params.pagination, params.filters);
}

export async function deleteBacktestStrategyById(
    id: number,
): Promise<{ deletedStrategy: number; deletedMints: number }> {
    return await db.transaction(async trx => {
        // delete children first
        const deletedMints = await trx(Tables.BacktestStrategyMintResults).where({ strategy_result_id: id }).del();

        // delete parent
        const deletedStrategy = await trx(Tables.BacktestStrategyResults).where({ id }).del();

        return { deletedStrategy, deletedMints };
    });
}

export type BacktestMintFullResult = Omit<ProtoBacktestMintFullResult, 'created_at'> & {
    created_at: Date;
};

export type BacktestsMintResultsFilters = {
    chain: Blockchain;
    backtestId?: string;
    backtestName?: string;
    strategyId?: string;
    strategyName?: string;
    strategyConfigVariant?: string;
    strategyResultId?: string;
} & CommonTradeFilters;

async function getBacktestStrategyMintResults(
    p: CompositeCursorPaginationParams,
    f: BacktestsMintResultsFilters,
): Promise<BacktestMintFullResult[]> {
    let backtests: Backtest[] | undefined;

    if (f.backtestId) {
        backtests = [await getBacktestById(f.backtestId)];
    } else if (f.backtestName) {
        backtests = [await getBacktest(f.chain, f.backtestName)];
    } else if (f.chain) {
        backtests = await db.table(Tables.Backtests).select<Backtest[]>().where('chain', f.chain);
    }

    const queryBuilder = db
        .table(Tables.BacktestStrategyResults)
        .select({
            id: scopedColumn(Tables.BacktestStrategyMintResults, 'id'),
            strategy_result_id: 'strategy_result_id',
            index: 'index',
            mint: 'mint',
            net_pnl: scopedColumn(Tables.BacktestStrategyMintResults, 'net_pnl_sol'),
            holdings_value: scopedColumn(Tables.BacktestStrategyMintResults, 'holdings_value_sol'),
            roi: scopedColumn(Tables.BacktestStrategyMintResults, 'roi'),
            exit_code: 'exit_code',
            exit_reason: 'exit_reason',
            payload: 'payload',
            created_at: scopedColumn(Tables.BacktestStrategyMintResults, 'created_at'),
        })
        .join(
            Tables.BacktestStrategyMintResults,
            scopedColumn(Tables.BacktestStrategyResults, 'id'),
            scopedColumn(Tables.BacktestStrategyMintResults, 'strategy_result_id'),
        )
        .orderBy([
            { column: scopedColumn(Tables.BacktestStrategyMintResults, 'created_at'), order: p.direction },
            { column: scopedColumn(Tables.BacktestStrategyMintResults, 'id'), order: p.direction },
        ])
        .limit(p.limit);

    if (backtests) {
        queryBuilder.whereIn(
            'backtest_id',
            backtests.map(el => el.id),
        );
    }

    if (f.strategyResultId) {
        queryBuilder.where('strategy_result_id', f.strategyResultId);
    }

    applyCommonTradeFilters(queryBuilder, f, {
        netPnlColumn: 'net_pnl_sol',
    });

    if (f.strategyId) {
        queryBuilder.where('strategy_id', f.strategyId);
    }

    if (f.strategyName) {
        queryBuilder.where('strategy', f.strategyName);
    }

    if (f.strategyConfigVariant) {
        queryBuilder.where('config_variant', f.strategyConfigVariant);
    }

    if (p.cursor) {
        applyCompositeCursorFilter(queryBuilder, p.cursor, Tables.BacktestStrategyMintResults, p.direction);
    }

    return normalizeOptionalFieldsInArray(await queryBuilder, [
        'net_pnl',
        'holdings_value',
        'roi',
        'exit_code',
        'exit_reason',
    ]);
}

export async function fetchBacktestsMintResultsCursorPaginated(
    params: RequestDataParams<BacktestsMintResultsFilters>,
): Promise<CursorPaginatedResponse<BacktestMintFullResult>> {
    return fetchCursorPaginatedData(getBacktestStrategyMintResults, params.pagination, params.filters);
}

export function formDraftMintResultFromBacktestMintResult(
    strategyResultId: number,
    bmr: StrategyMintBacktestResult,
): Omit<BacktestStrategyMintResult, 'id' | 'updated_at'> {
    const tradeResponse: BacktestTradeResponse | null = (
        (bmr.backtestResponse as BacktestTradeResponse)?.profitLossLamports ? bmr.backtestResponse : null
    ) as BacktestTradeResponse | null;

    let totalTradesCount = 0;
    let buyTradesCount = 0;
    let sellTradesCount = 0;
    if (tradeResponse) {
        for (const trade of tradeResponse.tradeHistory) {
            totalTradesCount++;
            if (trade.transactionType === 'buy') {
                buyTradesCount++;
            } else if (trade.transactionType === 'sell') {
                sellTradesCount++;
            }
        }
    }

    return {
        strategy_result_id: strategyResultId,
        index: bmr.index,
        mint: bmr.mint,
        mint_file_storage_type: bmr.mintFileStorageType,
        mint_file_path: bmr.mintFilePath,
        net_pnl_sol: tradeResponse ? lamportsToSol(tradeResponse.profitLossLamports) : null,
        holdings_value_sol: tradeResponse ? lamportsToSol(tradeResponse.holdings.lamportsValue) : null,
        total_trades_count: totalTradesCount,
        buy_trades_count: buyTradesCount,
        sell_trades_count: sellTradesCount,
        roi: tradeResponse?.roi ?? null,
        exit_code: (bmr.backtestResponse as BacktestExitResponse)?.exitCode ?? null,
        exit_reason: (bmr.backtestResponse as BacktestExitResponse)?.exitReason ?? null,
        payload: bmr.backtestResponse,
        created_at: new Date(bmr.createdAt),
    } satisfies Omit<BacktestStrategyMintResult, 'id' | 'updated_at'>;
}
