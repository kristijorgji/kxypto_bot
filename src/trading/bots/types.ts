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

export type Schema = {
    version: number;
    name?: string;
};

/**
 * Configuration options for the bot manager's processing behavior.
 */
export type BotManagerConfig = {
    /**
     * Schema metadata for this report file.
     * - `version` allows the report structure to evolve without breaking compatibility.
     * - `name` is optional and can be used to label or distinguish schema variants.
     */
    reportSchema: Schema;

    /**
     * The maximum number of tokens that can be processed in parallel.
     * - If set to `null`, there is no limit on parallel processing.
     * - If set to a number (e.g., `3`), the bot will process up to that many tokens simultaneously.
     */
    maxTokensToProcessInParallel: number | null;

    /**
     * Maximum number of open positions the bot can hold simultaneously.
     * - If set to `null`, the bot has no limit on open positions.
     * - If set to a number (e.g., `3`), the bot will pause listening for new coins
     *   until the current open positions are closed (sold) and fall below this limit.
     */
    maxOpenPositions: number | null;

    /**
     * The amount of full trades.
     * - If set to a number, the bot will process up to maximum 1 full trade (1 buy, 1 sell)
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    maxFullTrades: number | null;

    /**
     * Stop bots if this minimum balance is reached
     * - If set to a number, the bots will stop when this balance or lower is reached
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    stopAtMinWalletBalanceLamports: number | null;
} & BotConfig;

export type SellReason =
    | 'DUMPED'
    | 'TRAILING_STOP_LOSS'
    | 'STOP_LOSS'
    | 'TAKE_PROFIT'
    | 'TRAILING_TAKE_PROFIT'
    | 'AT_HARDCODED_PROFIT'
    | 'NO_LONGER_MEETS_ENTRY_RULES'
    | 'BEFORE_EXIT_MONITORING';

export type DoSellResponse = {
    reason: SellReason;
};

export type ShouldBuyResponse<R = string, D = Record<string, unknown>> = {
    buy: boolean;
    reason: R;
    data?: D;
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
