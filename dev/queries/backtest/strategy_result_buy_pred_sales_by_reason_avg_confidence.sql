set @strategyResultId = 65;

WITH expanded AS (SELECT smr.strategy_result_id,
                         smr.mint,
                         jt.idx,
                         jt.subCategory,
                         jt.reason,
                         jt.predictedBuyConfidence
                  FROM backtest_strategy_mint_results smr,
                       JSON_TABLE(
                               smr.payload, '$.tradeHistory[*]'
                           COLUMNS (
                                   idx FOR ORDINALITY,
                                   subCategory VARCHAR(50) PATH '$.subCategory',
                                   reason VARCHAR(255) PATH '$.metadata.reason',
                                   predictedBuyConfidence DOUBLE PATH '$.metadata.buyRes.data.predictedBuyConfidence'
                                   )
                       ) AS jt
                  WHERE smr.strategy_result_id = @strategyResultId),
     sell_with_confidence AS (SELECT s.reason,
                                     np.predictedBuyConfidence
                              FROM expanded s
                                       LEFT JOIN expanded np
                                                 ON s.strategy_result_id = np.strategy_result_id
                                                     AND s.mint = np.mint
                                                     AND np.subCategory = 'newPosition'
                              WHERE s.subCategory = 'sellAll')

SELECT reason,
       COUNT(*)                    AS count,
       AVG(predictedBuyConfidence) AS avgPredictedBuyConfidence
FROM sell_with_confidence
GROUP BY reason;
