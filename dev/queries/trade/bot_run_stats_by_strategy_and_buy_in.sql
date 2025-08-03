/**
 * Summarizes sales data for a specific bot run within the specified date range
 * and groups by strategy used
 */

set @fromDate = '2025-07-01 00:00:00';
set @untilDate = '2025-07-15 00:00:00';

WITH enriched_positions AS (
    SELECT
        JSON_UNQUOTE(JSON_EXTRACT(launchpad_token_reports.report, '$.strategy.name')) as strategy,
        JSON_UNQUOTE(JSON_EXTRACT(launchpad_token_reports.report, '$.strategy.configVariant')) as strategy_variant,
        ROUND(ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(buyTransaction.value, '$.grossTransferredLamports')) / 1e9 AS DECIMAL(38, 18))), 1) AS buy_in_sol,
        positions.realized_profit,
        positions.mode,
        positions.status
    FROM positions
             JOIN launchpad_token_results
                  ON launchpad_token_results.mint = positions.asset_mint
             LEFT JOIN launchpad_token_reports
                  ON launchpad_token_results.id = launchpad_token_reports.launchpad_token_result_id
             LEFT JOIN JSON_TABLE(report, '$.transactions[*]'
                             COLUMNS (
                                 transactionType VARCHAR(10) PATH '$.transactionType',
                                 value JSON PATH '$'
                             )
              ) AS buyTransaction ON buyTransaction.transactionType = 'buy'
    WHERE mode = 'real'
      AND status = 'closed'
      AND (@fromDate IS NULL OR positions.created_at >= @fromDate)
      AND (@untilDate IS NULL OR positions.created_at <= @untilDate)
)
select count(*)                                                    as full_trades,
       strategy,
       strategy_variant                                            as variant,
       buy_in_sol,
       (SUM(realized_profit > 0) / count(*)) * 100                 as win_rate_pct,
       SUM(realized_profit > 0)                                    AS wins,
       SUM(realized_profit < 0)                                    AS losses,
       FORMAT(sum(realized_profit), 5)                             as pnl_sol,
       FORMAT(SUM(IF(realized_profit > 0, realized_profit, 0)), 5) AS positive_pnl_sum,
       FORMAT(SUM(IF(realized_profit < 0, realized_profit, 0)), 5) AS negative_pnl_sum,
       FORMAT(MAX(IF(realized_profit > 0, realized_profit, 0)), 5) AS biggest_profit,
       FORMAT(MIN(IF(realized_profit < 0, realized_profit, 0)), 5) AS biggest_loss,
       @fromDate                                                   as from_date,
       @untilDate                                                  as until_date
from enriched_positions
group by strategy, strategy_variant, buy_in_sol;
