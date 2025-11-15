set @strategyResultId = 313;

/**
  If the exit_code is null and total_trades_count is 0, then can be considered NO_PUMP (NO_TRADE) as well
 */

select count(*) as count,
       exit_code
FROM backtest_strategy_mint_results
where strategy_result_id = @strategyResultId
group by exit_code
