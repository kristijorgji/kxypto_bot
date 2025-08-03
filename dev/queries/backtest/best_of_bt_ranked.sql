set @backtest_name = '3_sol_0.3_buy_randomized_7770f';

select
    backtest_strategy_results.id,
    strategy,
    config_variant,
    FORMAT(pnl_sol, 5)           as pnl,
    roi,
    win_rate,
    total_trades_count           as trades,
    FORMAT(lowest_trough_sol, 5) as trough,
    FORMAT(highest_peak_sol, 5)  as peak,
    wins_count                   as wins,
    losses_count                 as losses,
    max_drawdown_percentage      as max_drawdown_pct,
    backtest_strategy_results.created_at,
    execution_time_seconds

from backtest_strategy_results
inner join backtests on backtest_strategy_results.backtest_id = backtests.id
         where backtests.name = @backtest_name
order by roi desc
