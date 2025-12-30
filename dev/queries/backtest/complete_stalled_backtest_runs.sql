/**
 * RECOVERY & CLEANUP SCRIPT
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Finalizes stalled 'running' backtest runs and prunes associated transient
 *   strategy results. This is used after system crashes or manual cancellations.
 *
 * Logic:
 *   1. Identifies the LATEST completed strategy result for each active run.
 *   2. Sets the run to 'completed' and calculates the 'finished_at' time by
 *      adding execution duration to the result's creation timestamp.
 *   3. Preserves original 'updated_at' to maintain audit trails of the stall.
 *   4. Deletes remaining 'running' strategy records to prevent orphaned data.
 * -----------------------------------------------------------------------------
 */

START TRANSACTION;

-- 1. Update stalled runs using the latest associated strategy results
UPDATE backtest_runs r
JOIN (
    -- Subquery identifies the single most recent result per run
    SELECT bsr1.backtest_run_id, bsr1.created_at, bsr1.execution_time_seconds
    FROM backtest_strategy_results bsr1
    INNER JOIN (
        SELECT backtest_run_id, MAX(created_at) as max_created
        FROM backtest_strategy_results
        GROUP BY backtest_run_id
    ) bsr2 ON bsr1.backtest_run_id = bsr2.backtest_run_id
          AND bsr1.created_at = bsr2.max_created
) latest_results ON r.id = latest_results.backtest_run_id
SET
    r.status = 'completed',
    r.finished_at = DATE_ADD(latest_results.created_at, INTERVAL latest_results.execution_time_seconds SECOND),
    r.updated_at = r.updated_at -- Prevents automatic 'on update current_timestamp' trigger
WHERE r.status = 'running';

-- 2. Bulk delete orphaned strategy results linked to completed runs
DELETE bsr FROM backtest_strategy_results bsr
JOIN backtest_runs r ON bsr.backtest_run_id = r.id
WHERE r.status = 'completed'
  AND bsr.status = 'running';

COMMIT;
