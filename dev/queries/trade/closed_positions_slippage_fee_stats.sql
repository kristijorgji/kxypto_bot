SET @afterCreatedAt = '2025-06-30 15:18:35';

WITH enriched_positions AS (
    SELECT
        positions.asset_mint,
        positions.asset_name,
        positions.close_reason,
        positions.entry_price as actual_buy_price,
        positions.exit_price as actual_sell_price,
        (((positions.exit_price - positions.entry_price) / positions.entry_price) * 100) AS actual_p_diff_pct,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(buyTransaction.value, '$.metadata.historyEntry.price')) AS DECIMAL(38,18))  AS start_buy_price,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(sellTransaction.value, '$.metadata.historyEntry.price')) AS DECIMAL(38,18)) AS start_sell_price,
        positions.realized_profit,
        ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(buyTransaction.value, '$.grossTransferredLamports')) AS DECIMAL(38, 18)) / 1e9)  AS buy_tx_gross_transferred,
        (
             ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(buyTransaction.value, '$.netTransferredLamports')) AS DECIMAL(38, 18)))
            - ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(buyTransaction.value, '$.grossTransferredLamports')) AS DECIMAL(38, 18)))
        ) / 1e9 as buy_tx_fees,
        (
            ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(sellTransaction.value, '$.grossTransferredLamports')) AS DECIMAL(38, 18)))
            - ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(sellTransaction.value, '$.netTransferredLamports')) AS DECIMAL(38, 18)))
        ) / 1e9 as sell_tx_fees,
        positions.in_amount * positions.entry_price / 1e6 AS est_buy_in,
        positions.opened_at,
        positions.closed_at,
        positions.tx_signature,
        positions.exit_tx_signature
    FROM positions
             JOIN launchpad_token_results
                  ON launchpad_token_results.mint = positions.asset_mint
             JOIN launchpad_token_reports
                  ON launchpad_token_results.id = launchpad_token_reports.launchpad_token_result_id
             JOIN JSON_TABLE(report, '$.transactions[*]'
                             COLUMNS (
                                 transactionType VARCHAR(10) PATH '$.transactionType',
                                 value JSON PATH '$'
                                 )
                  ) AS buyTransaction
                  ON buyTransaction.transactionType = 'buy'
             JOIN JSON_TABLE(report, '$.transactions[*]'
                             COLUMNS (
                                 transactionType VARCHAR(10) PATH '$.transactionType',
                                 value JSON PATH '$'
                                 )
                  ) AS sellTransaction
                  ON sellTransaction.transactionType = 'sell'
    WHERE positions.mode = 'real'
      AND positions.status = 'closed'
      AND positions.in_amount = positions.exit_amount
      AND positions.created_at >= @afterCreatedAt
)
SELECT
    asset_mint as mint,
    asset_name as name,
    close_reason as reason,
    buy_tx_gross_transferred as buy_in,
    FORMAT(actual_p_diff_pct, 5) as actual_p_diff_pct,
    FORMAT((realized_profit / buy_tx_gross_transferred) * 100, 5) as roi,
    FORMAT(actual_p_diff_pct - (realized_profit / buy_tx_gross_transferred) * 100, 5) as fee_roi_impact_pct,
    FORMAT(((start_sell_price - start_buy_price) / start_buy_price) * 100, 5) AS start_p_diff_pct,
    FORMAT(realized_profit, 5) as pnl,
    (buy_tx_fees + sell_tx_fees) as tx_fees,
    # If actual buy is worse than expected → positive slippage (bad).
    FORMAT((actual_buy_price - start_buy_price) / start_buy_price * 100, 5) as buy_slippage_pct,
    # If actual sell price is better than expected → negative slippage (good).
    FORMAT((start_sell_price - actual_sell_price) / start_sell_price * 100, 5) as sell_slippage_pct,
    start_buy_price,
    actual_buy_price,
    start_sell_price,
    actual_sell_price,
    opened_at,
    closed_at,
    tx_signature,
    exit_tx_signature
FROM enriched_positions
ORDER BY actual_p_diff_pct DESC;
