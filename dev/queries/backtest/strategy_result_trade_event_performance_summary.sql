/*
DESCRIPTION:
    Calculates high-level performance metrics for a specific backtest strategy.
    Aggregates data to provide Win Rate, Trade Counts, and Total PnL.

VARIABLES:
    - @strategyResultId: The ID of the backtest run to analyze.
    - @trade_type: 'all', 'win', or 'loss'.
*/

-- 1. Setup Variables
SET @strategyResultId = 1365;
SET @trade_type = 'all';

-- 2. Execute Summary Query
SELECT
    strategy_result_id,
    COUNT(id) AS total_trades,
    COUNT(CASE WHEN net_pnl_sol > 0 THEN 1 END) AS win_count,
    COUNT(CASE WHEN net_pnl_sol < 0 THEN 1 END) AS loss_count,
    -- Calculate Win Rate % (Safe division)
    ROUND(
        (COUNT(CASE WHEN net_pnl_sol > 0 THEN 1 END) /
        NULLIF(COUNT(id), 0)) * 100,
    2) AS win_rate_percent,
    SUM(net_pnl_sol) AS total_net_pnl
FROM backtest_strategy_mint_results
WHERE
    strategy_result_id = @strategyResultId
    AND net_pnl_sol IS NOT NULL
    AND (
        (@trade_type = 'win' AND net_pnl_sol > 0) OR
        (@trade_type = 'loss' AND net_pnl_sol < 0) OR
        (@trade_type = 'all')
    );
