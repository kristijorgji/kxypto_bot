/**
 * Summarizes sales data for a specific bot run within the specified date range
 *
 */

set @fromDate = '2025-07-01 00:00:00';
set @untilDate = '2025-07-15 00:00:00';

select count(*)                                                    as full_trades,
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
from positions
where mode = 'real'
  and status = 'closed'
  AND (@fromDate IS NULL OR created_at >= @fromDate)
  and (@untilDate IS NULL OR created_at <= @untilDate);
