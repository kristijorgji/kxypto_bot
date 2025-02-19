export type TransactionType = 'buy' | 'sell';

export type SwapSubCategory = 'accumulation' | 'newPosition' | 'partialSell' | 'sellAll';

export type BotConfig = {
    simulate: boolean;
    afterResultMonitorWaitPeriodMs: number;
    maxWaitMonitorAfterResultMs: number;
};

export type SellReason =
    | 'DUMPED'
    | 'TRAILING_STOP_LOSS'
    | 'TAKE_PROFIT'
    | 'TRAILING_TAKE_PROFIT'
    | 'AT_HARDCODED_PROFIT';

export type DoSellResponse = {
    reason: SellReason;
};

export type ShouldSellResponse = false | DoSellResponse;

export type ExitMonitoringReason = 'NO_PUMP' | 'DUMPED';

export type ShouldExitMonitoringResponse =
    | false
    | {
          exitCode: ExitMonitoringReason;
          message: string;
          shouldSell: ShouldSellResponse;
      };
