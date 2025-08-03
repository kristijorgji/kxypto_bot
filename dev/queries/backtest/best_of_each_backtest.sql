WITH RankedBacktests AS (SELECT backtest_id,
                                backtests.name                                                 AS backtest,
                                strategy,
                                config_variant,
                                pnl_sol,
                                roi,
                                backtest_strategy_results.win_rate,
                                backtest_strategy_results.total_trades_count,
                                backtest_strategy_results.highest_peak_sol,
                                backtest_strategy_results.lowest_trough_sol,
                                backtest_strategy_results.wins_count,
                                backtest_strategy_results.losses_count,
                                backtest_strategy_results.max_drawdown_percentage,
                                backtest_strategy_results.execution_time_seconds,
                                backtest_strategy_results.created_at,
                                -- Assign a rank to each variant within its backtest group, ordered by ROI
                                ROW_NUMBER() OVER (PARTITION BY backtest_id ORDER BY roi DESC) AS rn
                         FROM backtest_strategy_results
                                  INNER JOIN backtests ON backtest_strategy_results.backtest_id = backtests.id
                         where backtests.name like '%_7770f'
                           and total_trades_count >= 12)
SELECT backtest,
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
       created_at,
       execution_time_seconds
FROM RankedBacktests
WHERE rn = 1
ORDER BY roi DESC;
