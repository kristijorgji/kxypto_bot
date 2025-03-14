export type TransactionType = 'buy' | 'sell';

export type SwapSubCategory = 'accumulation' | 'newPosition' | 'partialSell' | 'sellAll';

export type BotConfig = {
    /**
     * Whether the bot should run in simulation mode.
     * If true, no real transactions will be executed.
     */
    simulate: boolean;

    /**
     * The interval (in milliseconds) at which market data is fetched while monitoring before a buy occurs.
     * This value must be greater than or equal to `sellMonitorWaitPeriodMs`.
     * Additionally, `buyMonitorWaitPeriodMs / sellMonitorWaitPeriodMs` must be a whole number.
     */
    buyMonitorWaitPeriodMs: number;

    /**
     * The interval (in milliseconds) at which market data is fetched while monitoring after a buy occurs.
     * This value must be less than or equal to `buyMonitorWaitPeriodMs`.
     */
    sellMonitorWaitPeriodMs: number;

    /**
     * The time (in milliseconds) to wait after a result is processed before returning the result.
     */
    maxWaitMonitorAfterResultMs: number;

    /**
     * The amount of SOL to use for buying tokens.
     * - If set to `null`, the bot will dynamically determine the optimal value based on market conditions.
     * - If set to a number, it specifies a fixed buy-in amount in SOL.
     */
    buyInSol: number | null;
};

export type SellReason =
    | 'DUMPED'
    | 'TRAILING_STOP_LOSS'
    | 'STOP_LOSS'
    | 'TAKE_PROFIT'
    | 'TRAILING_TAKE_PROFIT'
    | 'AT_HARDCODED_PROFIT'
    | 'NO_LONGER_MEETS_ENTRY_RULES';

export type DoSellResponse = {
    reason: SellReason;
};

export type ShouldSellResponse = false | DoSellResponse;

export type ExitMonitoringReason = 'NO_PUMP' | 'DUMPED' | 'STOPPED' | 'BAD_CREATOR';

export type ShouldExitMonitoringResponse =
    | false
    | {
          exitCode: ExitMonitoringReason;
          message: string;
          shouldSell: ShouldSellResponse;
      };
