set @strategyResultId = 196;

SELECT jt.reason,
       COUNT(*) AS count
FROM backtest_strategy_mint_results smr,
     JSON_TABLE(
             smr.payload, '$.tradeHistory[*]'
             COLUMNS (
                 subCategory VARCHAR(50) PATH '$.subCategory', reason VARCHAR(255) PATH '$.metadata.reason'
                 )
     ) AS jt
WHERE jt.subCategory = 'sellAll'
  AND smr.strategy_result_id = @strategyResultId
GROUP BY jt.reason;
