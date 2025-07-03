set @afterCreatedAt = '2025-06-30 15:18:35';

select count(*) as count,
       sum(realized_profit)                     as sum_sol,
       (IF(realized_profit > 0, 'win', 'loss')) as type
from positions
where mode = 'real'
  and status = 'closed'
  and created_at >= @afterCreatedAt
group by (IF(realized_profit > 0, 'win', 'loss'));
