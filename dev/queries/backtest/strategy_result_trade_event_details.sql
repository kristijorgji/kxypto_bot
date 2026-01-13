/*
DESCRIPTION: Unpacks the JSON 'payload' into individual trade actions.
             Filters out non-trade rows (net_pnl_sol IS NULL).

VARIABLES:
  - @strategyResultId: The ID from backtest_strategy_results
  - @trade_type:
      'win'  -> PnL > 0
      'loss' -> PnL <= 0
      'all'  -> Every actual trade
  - @filter_action:
      'all'  -> Every event (startBuy, buyCompleted, etc.)
      'xyz'  -> Filter for a specific event name
*/

-- 1. Setup Variables
SET @strategyResultId = 1365;
SET @trade_type = 'win';      -- Options: 'win', 'loss', 'all'
SET @filter_action = 'all';   -- Options: 'startBuy', 'buyCompleted', 'startSell', 'sellCompleted', or 'all'

-- 2. Execute Query
SELECT
    base.id,
    base.mint,
    jt.action,
    jt.history_index,
    base.net_pnl_sol
FROM backtest_strategy_mint_results AS base
-- Using LEFT JOIN ensures we don't lose rows with empty payloads
LEFT JOIN JSON_TABLE(
    base.payload,
    '$.events[*]'
    COLUMNS (
        action VARCHAR(50) PATH '$.action',
        history_index INT PATH '$.historyRef.index'
    )
) AS jt ON TRUE
WHERE
    base.strategy_result_id = @strategyResultId
    AND net_pnl_sol IS NOT NULL

    -- Filter 1: Profit/Loss logic
    AND (
        (@trade_type = 'win' AND base.net_pnl_sol > 0) OR
        (@trade_type = 'loss' AND base.net_pnl_sol <= 0) OR
        (@trade_type = 'all')
    )

    -- Filter 2: Action logic
    -- Note: We include 'jt.action IS NULL' to keep rows that have no events when @filter_action is 'all'
    AND (
        (jt.action = @filter_action) OR
        (@filter_action = 'all')
    )
ORDER BY base.id, jt.history_index ASC;
