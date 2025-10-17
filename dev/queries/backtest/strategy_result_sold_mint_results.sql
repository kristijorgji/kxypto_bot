set @strategyResultId = 4209;

SELECT mint,
       FORMAT(net_pnl_sol, 5) as net_pnl_sol,
       jt.reason,
       created_at
FROM backtest_strategy_mint_results smr,
     JSON_TABLE(
             smr.payload, '$.tradeHistory[*]'
             COLUMNS (
                 subCategory VARCHAR(50) PATH '$.subCategory', reason VARCHAR(255) PATH '$.metadata.reason'
                 )
     ) AS jt
WHERE jt.subCategory = 'sellAll'
  AND smr.strategy_result_id = @strategyResultId
