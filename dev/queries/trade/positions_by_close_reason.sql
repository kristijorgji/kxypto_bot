set @fromDate = '2025-07-31 00:00:00';
set @untilDate = '2027-07-15 00:00:00';

select count(*)   as count,
       close_reason,
       @fromDate  as from_date,
       @untilDate as until_date
from positions
where mode = 'real'
  and status = 'closed'
  and (@fromDate IS NULL OR created_at >= @fromDate)
  and (@untilDate IS NULL OR created_at <= @untilDate)
group by close_reason;
