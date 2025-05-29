import { lamportsToSol } from '../../blockchains/utils/amount';
import {
    BacktestExitResponse,
    BacktestTradeResponse,
    StrategyBacktestResult,
} from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import { db } from '../knex';
import { Tables } from '../tables';
import { Backtest, BacktestStrategyMintResult, BacktestStrategyResult } from '../types';

export async function getBacktest(id: string): Promise<Backtest> {
    const r = await db.table(Tables.Backtests).select<Backtest>().where('id', id).first();
    if (!r) {
        throw new Error(`Backtest with id ${id} was not found`);
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
): Promise<void> {
    await db.transaction(async trx => {
        const [strategyResultId] = (await trx(Tables.BacktestStrategyResults).insert({
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
        } satisfies Omit<BacktestStrategyResult, 'id' | 'created_at' | 'updated_at'>)) as [number];

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
