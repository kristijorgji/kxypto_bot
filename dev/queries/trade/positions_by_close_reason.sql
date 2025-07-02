select count(*) as count,
       close_reason
from positions
where mode = 'real'
  and status = 'closed'
  and created_at >= '2025-06-30 15:18:35'
group by close_reason;
