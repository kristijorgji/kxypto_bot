DELETE FROM backtest_runs
WHERE status != 'pending'
  AND id IN (
    SELECT id
    FROM (
        SELECT backtest_runs.id
        FROM backtest_runs
        LEFT JOIN backtest_strategy_results bsr ON backtest_runs.id = bsr.backtest_run_id
        WHERE bsr.backtest_run_id IS NULL
    ) AS tmp
);
