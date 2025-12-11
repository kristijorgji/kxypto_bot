import { z } from 'zod';

export type TransactionType = 'buy' | 'sell';

export type SwapSubCategory = 'accumulation' | 'newPosition' | 'partialSell' | 'sellAll';

const botConfigSchema = z.object({
    /**
     * Whether the bot should run in simulation mode.
     * If true, no real transactions will be executed.
     */
    simulate: z.boolean(),

    /**
     * The interval (in milliseconds) at which market data is fetched while monitoring before a buy occurs.
     * This value must be greater than or equal to `sellMonitorWaitPeriodMs`.
     * Additionally, `buyMonitorWaitPeriodMs / sellMonitorWaitPeriodMs` must be a whole number.
     */
    buyMonitorWaitPeriodMs: z.number().positive(),

    /**
     * The interval (in milliseconds) at which market data is fetched while monitoring after a buy occurs.
     * This value must be less than or equal to `buyMonitorWaitPeriodMs`.
     */
    sellMonitorWaitPeriodMs: z.number().positive(),

    /**
     * The time (in milliseconds) to wait after a result is processed before returning the result.
     */
    maxWaitMonitorAfterResultMs: z.number().positive(),

    /**
     * Optional timeout in milliseconds to automatically sell a token if it hasn't been sold
     * by other means (e.g., hitting limit orders). When this timeout is reached, the bot
     * triggers a forced sell to avoid holding the token indefinitely.
     *
     * If not set, no automatic forced sell by timeout will occur.
     */
    autoSellTimeoutMs: z.number().positive().optional(),

    /**
     * The amount of SOL to use for buying tokens.
     * - If set to `null`, the bot will dynamically determine the optimal value based on market conditions.
     * - If set to a number, it specifies a fixed buy-in amount in SOL.
     */
    buyInSol: z.number().positive().nullable(),

    /**
     * The maximum number of times the bot will retry selling
     * a token if the initial sell transaction fails.
     * - Useful for handling temporary network or RPC issues.
     */
    maxSellRetries: z.number().int().min(0).max(10),
});
export type BotConfig = z.infer<typeof botConfigSchema>;

const botManagerConfigSpecificSchema = z.object({
    /**
     * Schema metadata for this report file.
     * - `version` allows the report structure to evolve without breaking compatibility.
     * - `name` is optional and can be used to label or distinguish schema variants.
     */
    reportSchema: z.object({
        version: z.number(),
        name: z.string().optional(),
    }),

    /**
     * The maximum number of tokens that can be processed in parallel.
     * - If set to `null`, there is no limit on parallel processing.
     * - If set to a number (e.g., `3`), the bot will process up to that many tokens simultaneously.
     */
    maxTokensToProcessInParallel: z.number().positive().nullable(),

    /**
     * Maximum number of open positions the bot can hold simultaneously.
     * - If set to `null`, the bot has no limit on open positions.
     * - If set to a number (e.g., `3`), the bot will pause listening for new coins
     *   until the current open positions are closed (sold) and fall below this limit.
     */
    maxOpenPositions: z.number().positive().nullable(),

    /**
     * The amount of full trades.
     * - If set to a number, the bot will process up to maximum 1 full trade (1 buy, 1 sell)
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    maxFullTrades: z.number().positive().nullable(),

    /**
     * Stop bots if this minimum balance is reached
     * - If set to a number, the bots will stop when this balance or lower is reached
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    stopAtMinWalletBalanceLamports: z.number().positive().nullable(),
});

export const botManagerConfigSchema = botConfigSchema.merge(botManagerConfigSpecificSchema).strict();
/**
 * Configuration options for the bot manager's processing behavior.
 */
export type BotManagerConfig = z.infer<typeof botManagerConfigSchema>;

export type Schema = BotManagerConfig['reportSchema'];

export type SellReason =
    | 'DUMPED'
    | 'TRAILING_STOP_LOSS'
    | 'STOP_LOSS'
    | 'TAKE_PROFIT'
    | 'CONSECUTIVE_SELL_PREDICTION_CONFIRMATIONS'
    | 'TRAILING_TAKE_PROFIT'
    | 'AT_HARDCODED_PROFIT'
    | 'NO_LONGER_MEETS_ENTRY_RULES'
    | 'BEFORE_EXIT_MONITORING'
    | 'AUTO_SELL_TIMEOUT';

export type DoSellResponse = {
    reason: SellReason;
};

export type ShouldBuyResponse<R = string, D = Record<string, unknown>> = {
    buy: boolean;
    reason: R;
    data?: D;
};

export type ShouldSellResponse<FR = string, D = Record<string, unknown>> =
    | {
          sell: true;
          reason: SellReason;
          data?: D;
      }
    | {
          sell: false;
          reason: FR;
          data?: D;
      };

export const exitMonitoringReasonEnum = z.enum(['NO_PUMP', 'DUMPED', 'STOPPED', 'BAD_CREATOR']);
export type ExitMonitoringReason = z.infer<typeof exitMonitoringReasonEnum>;

export type ShouldExitMonitoringResponse =
    | false
    | {
          exitCode: ExitMonitoringReason;
          message: string;
          shouldSell: false | DoSellResponse;
      };

export const modeEnum = z.enum(['real', 'simulation']);
export type Mode = z.infer<typeof modeEnum>;

export type HistoryRef = {
    timestamp: number;
    index: number;
};

export type BotAction =
    | 'startBuy'
    | 'buyCompleted'
    | 'buyError'
    | 'startSell'
    | 'sellCompleted'
    | 'sellError'
    | 'strategyExit';

export type BotEvent = {
    historyRef: HistoryRef;
    action: BotAction;
    reason?: string;
};

export type BotStrategy = {
    id: string;
    name: string;
    configVariant: string;
};

export type BotMonitorConfig = {
    buyTimeframeMs: number;
    sellTimeframeMs: number;
};

export type BoughtSold = {
    address: string;
    name: string;
    symbol: string;
    amount: number;
};
