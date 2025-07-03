set @afterCreatedAt = '2025-06-30 15:18:35';

select count(*) as count,
       close_reason
from positions
where mode = 'real'
  and status = 'closed'
  and created_at >= @afterCreatedAt
group by close_reason;
