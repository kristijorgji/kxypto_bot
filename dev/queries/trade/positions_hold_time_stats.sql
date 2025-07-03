-- ----------------------------------------------------------------------------------
-- This script compares hold durations between two sources:
--   1. The `positions` table using created_at and closed_at timestamps.
--   2. The `launchpad_token_results` joined with JSON-based buy/sell timestamps
--      extracted from the `transactions` array in the `report` JSON column.
--
-- It filters data to only include records created after @afterCreatedAt,
-- and outputs the count, average, minimum and maximum hold durations (in seconds)
-- for both sources, labeled accordingly using UNION ALL.
-- ----------------------------------------------------------------------------------

set @afterCreatedAt = '2025-07-01 15:44:36';

(
    SELECT
        'positions' as source,
        count(*)                                          as count,
        AVG(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as avg_hold_s,
        MIN(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as min_hold_s,
        MAX(TIMESTAMPDIFF(SECOND, created_at, closed_at)) as max_hold_s
    FROM positions
    WHERE mode = 'real'
      AND status = 'closed'
      AND created_at >= @afterCreatedAt
)
UNION ALL
(
    SELECT
        'launchpad_token_results' as source,
        count(*) as count,
        AVG((sell_ts - buy_ts) / 1000) as avg_hold_s,
        min((sell_ts - buy_ts) / 1000) as min_hold_s,
        MAX((sell_ts - buy_ts) / 1000) as max_hold_s
    FROM
        (
            SELECT
                CAST(JSON_UNQUOTE(JSON_EXTRACT(buy.value, '$.metadata.historyRef.timestamp')) AS UNSIGNED) AS buy_ts,
                CAST(JSON_UNQUOTE(JSON_EXTRACT(sell.value, '$.metadata.historyRef.timestamp')) AS UNSIGNED) AS sell_ts
            FROM launchpad_token_results
                     JOIN launchpad_token_reports on launchpad_token_results.id = launchpad_token_reports.launchpad_token_result_id
                AND launchpad_token_results.simulation = 0
                AND launchpad_token_results.exit_code is null
                     JOIN JSON_TABLE(report, '$.transactions[*]'
                                     COLUMNS (
                                         transactionType VARCHAR(10) PATH '$.transactionType',
                                         value JSON PATH '$'
                                         )
                          ) AS buy ON buy.transactionType = 'buy'
                     JOIN JSON_TABLE(report, '$.transactions[*]'
                                     COLUMNS (
                                         transactionType VARCHAR(10) PATH '$.transactionType',
                                         value JSON PATH '$'
                                         )
                          ) AS sell ON sell.transactionType = 'sell'
            WHERE launchpad_token_results.created_at >= @afterCreatedAt
        ) AS timestamps
)
