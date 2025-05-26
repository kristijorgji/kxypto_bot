import { lamportsToSol } from '../../blockchains/utils/amount';
import { StrategyBacktestResult } from '../../trading/bots/blockchains/solana/types';
import LaunchpadBotStrategy from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import { db } from '../knex';
import { Tables } from '../tables';
import { Backtest } from '../types';

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

export async function storeStrategyResult(
    backtestId: string,
    strategy: LaunchpadBotStrategy,
    sr: StrategyBacktestResult,
): Promise<void> {
    await db.table(Tables.StrategyResults).insert({
        backtest_id: backtestId,
        strategy: strategy.name,
        config_variant: strategy.configVariant,
        config: strategy.config,
        pln_sol: sr.totalPnlInSol,
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
    });
}
