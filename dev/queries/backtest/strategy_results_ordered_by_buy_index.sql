SELECT
    bsr.id,
    bsr.config_variant,
    AVG(buyIndex) as avgBuyIndex
FROM backtest_strategy_mint_results smr
         JOIN crypto_bot.backtest_strategy_results bsr on bsr.id = smr.strategy_result_id
         JOIN JSON_TABLE(
        smr.payload, '$.tradeHistory[*]'
            COLUMNS (
            transactionType VARCHAR(50) PATH '$.transactionType',
            subCategory VARCHAR(50) PATH '$.subCategory',
            buyIndex INT(10) UNSIGNED PATH '$.metadata.historyRef.index'
            )
              ) AS jt
WHERE jt.transactionType = 'buy'
  and jt.subCategory = 'newPosition'
GROUP BY strategy_result_id
order by avgBuyIndex asc
