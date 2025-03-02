// example 2023-03-20 12:57:02
export type MySQLTimestamp = string;

export type ApmEntry = {
    id: string;
    name: string;
    start_timestamp_ms: number;
    execution_time_ns: number;
};

export type Token<T = Record<string, unknown>> = {
    chain: 'solana';
    mint: string;
    name: string;
    symbol: string;
    other: T;
    createdOn: 'https://pump.fun' | string;
    token_created_at: Date;
};

export type Backtest = {
    id: string;
    config: Record<string, unknown>;
};
