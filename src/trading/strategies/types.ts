export type StrategyConfig = {
    variant?: string;
    buyMonitorWaitPeriodMs: number;
    sellMonitorWaitPeriodMs: number;
    /**
     * don't waste time on a token anymore if there is no increase until this time is reached
     */
    maxWaitMs: number;
    buySlippageDecimal: number;
    sellSlippageDecimal: number;
    priorityFeeInSol?: number;
    buyPriorityFeeInSol?: number;
    sellPriorityFeeInSol?: number;
};
