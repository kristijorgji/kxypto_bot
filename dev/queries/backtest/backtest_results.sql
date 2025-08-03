select backtests.name               as backtest,
       config_variant               as v,
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
#where backtest_id = 'e6e21319-e06a-4ad1-9429-2d342273d05a'
    and backtests.created_at >= '2025-07-07 11:34:47'
order by backtest_strategy_results.created_at desc;
