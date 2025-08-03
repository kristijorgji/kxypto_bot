set @fromDate = '2025-07-01 00:00:00';
set @untilDate = '2025-07-015 00:00:00';

select count(*)                                 as count,
       sum(realized_profit)                     as sum_sol,
       (IF(realized_profit > 0, 'win', 'loss')) as type,
       @fromDate                                as from_date,
       @untilDate                               as until_date
from positions
where mode = 'real'
  and status = 'closed'
  and (@fromDate IS NULL OR created_at >= @fromDate)
  and (@untilDate IS NULL OR created_at <= @untilDate)
group by (IF(realized_profit > 0, 'win', 'loss'));
