DELIMITER $$

CREATE PROCEDURE BatchDeleteNonProfitableStrategyResults(
    IN batch_size INT
)
BEGIN
    -- Variable 1: Tracks the current parent ID being processed.
    DECLARE current_parent_id BIGINT;

    -- Variable 2: Tracks the total number of mint result rows deleted. (OUTPUT 1)
    DECLARE total_deleted_mint_results BIGINT DEFAULT 0;

    -- Variable 3: Tracks the total number of strategy result rows deleted. (OUTPUT 2)
    DECLARE total_deleted_parents BIGINT DEFAULT 0;

    -- Variable 4: Holds the row count from the last DELETE operation.
    DECLARE last_batch_deleted_count INT;

    -- Step 1: Create the main temporary table to hold ALL parent IDs that need deletion.
    CREATE TEMPORARY TABLE IF NOT EXISTS backtest_strategy_result_ids_to_delete
    (
        id BIGINT PRIMARY KEY
    );

    -- Insert all *Parent* IDs (Strategy Result IDs) where pnl_sol is negative.
    INSERT INTO backtest_strategy_result_ids_to_delete (id)
    SELECT id
    FROM backtest_strategy_results
    WHERE backtest_strategy_results.pnl_sol <= 0;

    -- Step 2: Loop to process and clear out IDs one by one.
    -- The loop continues as long as there are IDs left in the backtest_strategy_result_ids_to_delete queue.
    WHILE EXISTS (SELECT 1 FROM backtest_strategy_result_ids_to_delete LIMIT 1)
        DO
            -- 2.1: Get the next Parent ID (the one we focus on for this loop iteration).
            SELECT id
            INTO current_parent_id
            FROM backtest_strategy_result_ids_to_delete
            ORDER BY id
            LIMIT 1;

            -- 2.2: Delete a batch of child rows associated with this specific parent ID.
            DELETE
            FROM backtest_strategy_mint_results
            WHERE strategy_result_id = current_parent_id
            LIMIT batch_size;

            -- Store the count of deleted rows for this batch.
            SET last_batch_deleted_count = ROW_COUNT();

            -- Accumulate to the total mint results counter.
            SET total_deleted_mint_results = total_deleted_mint_results + last_batch_deleted_count;

            -- 2.3: Check if any child rows remain for this parent ID.
            IF last_batch_deleted_count < batch_size THEN
                -- If we deleted less than the batch_size, or there are no more matches,
                -- we assume the deletion for this ID is complete.

                -- Delete the parent ID from the queue.
                DELETE FROM backtest_strategy_result_ids_to_delete WHERE id = current_parent_id;

                -- Delete the parent record from its main table.
                DELETE
                FROM backtest_strategy_results
                WHERE id = current_parent_id;

                -- Accumulate to the total parents counter.
                SET total_deleted_parents = total_deleted_parents + 1;

            END IF;

            -- 2.4: COMMIT to release locks acquired in this batch, preventing Error 1206.
            COMMIT;

        END WHILE;

    -- Step 3: Clean up the main temporary table.
    DROP TEMPORARY TABLE backtest_strategy_result_ids_to_delete;

    -- Step 4: Return both final counts. This will display a two-column result set
    -- when the CALL completes, showing the final totals.
    SELECT total_deleted_mint_results AS TotalMintResultsDeleted,
           total_deleted_parents      AS TotalStrategyResultsDeleted;

END$$

-- Reset the delimiter back to the default
DELIMITER ;

-- EXECUTION
CALL BatchDeleteNonProfitableStrategyResults(10000);

-- CLEANUP
DROP PROCEDURE IF EXISTS BatchDeleteNonProfitableStrategyResults;
