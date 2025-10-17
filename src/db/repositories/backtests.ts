import { lamportsToSol } from '@src/blockchains/utils/amount';
import { CommonTradeFilters, applyCommonTradeFilters } from '@src/db/repositories/launchpad_tokens';
import { CompositeCursorPaginationParams } from '@src/db/repositories/types';
import fetchCursorPaginatedData from '@src/db/utils/fetchCursorPaginatedData';
import { applyCompositeCursorFilter, scopedColumn } from '@src/db/utils/queries';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { ProtoBacktestMintFullResult, ProtoBacktestStrategyFullResult } from '@src/protos/generated/backtests';
import {
    BacktestExitResponse,
    BacktestTradeResponse,
    StrategyBacktestResult,
} from '@src/trading/bots/blockchains/solana/types';
import { RequestDataParams } from '@src/ws-api/types';

import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import { db } from '../knex';
import { Tables } from '../tables';
import { Backtest, BacktestStrategyMintResult, BacktestStrategyResult, Blockchain } from '../types';

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

export async function storeBacktestStrategyResult(
    backtestId: string,
    strategy: LaunchpadBotStrategy,
    sr: StrategyBacktestResult,
    executionTimeSeconds: number,
): Promise<BacktestStrategyResult> {
    return await db.transaction<BacktestStrategyResult>(async trx => {
        const now = new Date();
        const backtestStrategyResult: Omit<BacktestStrategyResult, 'id'> = {
            backtest_id: backtestId,
            strategy: strategy.name,
            strategy_id: strategy.identifier,
            config_variant: strategy.configVariant,
            config: strategy.config,
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
            created_at: now,
            updated_at: now,
        };
        const [strategyResultId] = (await trx(Tables.BacktestStrategyResults).insert(backtestStrategyResult)) as [
            number,
        ];

        const mintResults = [];
        for (const [mint, { mintFileStorageType, mintFilePath, backtestResponse: result }] of Object.entries(
            sr.mintResults,
        )) {
            const tradeResponse: BacktestTradeResponse | null = (
                (result as BacktestTradeResponse)?.profitLossLamports ? result : null
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

            mintResults.push({
                strategy_result_id: strategyResultId,
                mint: mint,
                mint_file_storage_type: mintFileStorageType,
                mint_file_path: mintFilePath,
                net_pnl_sol: tradeResponse ? lamportsToSol(tradeResponse.profitLossLamports) : null,
                holdings_value_sol: tradeResponse ? lamportsToSol(tradeResponse.holdings.lamportsValue) : null,
                total_trades_count: totalTradesCount,
                buy_trades_count: buyTradesCount,
                sell_trades_count: sellTradesCount,
                roi: tradeResponse?.roi ?? null,
                exit_code: (result as BacktestExitResponse)?.exitCode ?? null,
                exit_reason: (result as BacktestExitResponse)?.exitReason ?? null,
                payload: result,
            } satisfies Omit<BacktestStrategyMintResult, 'id' | 'created_at' | 'updated_at'>);
        }

        await trx(Tables.BacktestStrategyMintResults).insert(mintResults);

        return {
            id: strategyResultId,
            ...backtestStrategyResult,
        };
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

export type BacktestStrategyFullResult = ProtoBacktestStrategyFullResult;

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

export type BacktestMintFullResult = ProtoBacktestMintFullResult;

export type BacktestsMintResultsFilters = {
    chain: Blockchain;
    backtestId?: string;
    backtestName?: string;
    strategyId?: string;
    strategyName?: string;
    strategyConfigVariant?: string;
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
            backtest_id: 'backtest_id',
            config_variant: 'config_variant',
            strategy_result_id: 'strategy_result_id',
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

    return queryBuilder;
}

export async function fetchBacktestsMintResultsCursorPaginated(
    params: RequestDataParams<BacktestsMintResultsFilters>,
): Promise<CursorPaginatedResponse<BacktestMintFullResult>> {
    return fetchCursorPaginatedData(getBacktestStrategyMintResults, params.pagination, params.filters);
}
