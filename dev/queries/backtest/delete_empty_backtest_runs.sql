delete from backtest_runs
where id in (
    select id
    from (
        select backtest_runs.id
        from backtest_runs
        left join backtest_strategy_results bsr on backtest_runs.id = bsr.backtest_run_id
        where bsr.backtest_run_id is null
    ) as tmp
);
