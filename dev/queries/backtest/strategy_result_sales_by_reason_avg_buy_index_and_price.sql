/**
 * Summarizes sales data for a specific strategy result.
 *
 * For the given strategyResultId:
 * - Groups sales by their reason
 * - Returns the count of sales per reason
 * - Calculates the average buy index, average buy price and average buy confidence for each reason
 */
set @strategyResultId = 196;

WITH expanded AS (SELECT smr.strategy_result_id,
                         smr.mint,
                         jt.idx,
                         jt.transactionType,
                         jt.subCategory,
                         jt.reason,
                         jt.actionIndex,
                         jt.pumpBuyPriceInSol,
                         jt.predictedBuyConfidence
                  FROM backtest_strategy_mint_results smr,
                       JSON_TABLE(
                               smr.payload, '$.tradeHistory[*]'
                               COLUMNS (
                                   idx FOR ORDINALITY,
                                   transactionType VARCHAR(50) PATH '$.transactionType',
                                   subCategory VARCHAR(50) PATH '$.subCategory',
                                   reason VARCHAR(255) PATH '$.metadata.reason',
                                   actionIndex INT(10) UNSIGNED PATH '$.metadata.historyRef.index',
                                   pumpBuyPriceInSol DOUBLE PATH '$.metadata.pumpBuyPriceInSol',
                                   predictedBuyConfidence DOUBLE PATH '$.metadata.buyRes.data.predictedBuyConfidence'
                                   )
                       ) AS jt
                  WHERE smr.strategy_result_id = @strategyResultId),
     sell_with_insights AS (SELECT s.reason,
                                   np.actionIndex,
                                   np.pumpBuyPriceInSol,
                                   np.predictedBuyConfidence
                            FROM expanded s
                                     LEFT JOIN expanded np
                                               ON s.strategy_result_id = np.strategy_result_id
                                                   AND s.mint = np.mint
                                                   AND np.transactionType = 'buy'
                                                   AND np.subCategory = 'newPosition'
                            WHERE s.subCategory = 'sellAll')

SELECT reason,
       COUNT(*)                    AS count,
       AVG(actionIndex)            AS avgActionIndex,
       AVG(pumpBuyPriceInSol)      AS avgPumpBuyPriceInSol,
       AVG(predictedBuyConfidence) AS avgPredictedBuyConfidence
FROM sell_with_insights
GROUP BY reason;
