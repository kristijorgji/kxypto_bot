WITH Ordered AS (
    SELECT
        name,
        provider,
        (execution_time_ns / 1e9) as execution_time_s,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY execution_time_ns) AS row_num,
        COUNT(*) OVER (PARTITION BY name) AS total_count
    FROM crypto_bot.apm
)
SELECT
    name,
    provider,
    count(*) as count,
    MIN(execution_time_s) AS min_time_s,
    MAX(execution_time_s) AS max_time_s,
    AVG(execution_time_s) AS avg_time_s,
    (SELECT execution_time_s FROM Ordered o2
     WHERE o2.name = Ordered.name
       AND o2.row_num = FLOOR(o2.total_count * 0.5) + 1
    ) AS median_time_s
FROM Ordered
GROUP BY name, provider;
