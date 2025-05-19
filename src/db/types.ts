import { ExitMonitoringReason, SellReason } from '../trading/bots/types';

// example 2023-03-20 12:57:02
export type MySQLTimestamp = string;

export type User = {
    id: string;
    name: string;
    email: string;
    password: string;
    username: string;
};

export type Session = {
    id: string;
    user_id: string;
    refresh_token: string;
    is_blocked: boolean;
    expires_at: number;
};

export type ApmEntry = {
    id: string;
    name: string;
    start_timestamp_ms: number;
    execution_time_ns: number;
};

export type Blockchain = 'solana' | 'ethereum';

export type Token<T = Record<string, unknown>> = {
    chain: Blockchain;
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

export type Position = {
    id: number;
    trade_id: string;
    chain: Blockchain;
    exchange: 'pumpfun';
    user_address: string;
    asset_mint: string;
    asset_name: string;
    asset_symbol: string;
    entry_price: number;
    in_amount: number;
    stop_loss: number | null;
    trailing_sl_percent: number | null;
    take_profit: number | null;
    trailing_take_profit_percent: number | null;
    trailing_take_profit_stop_percent: number | null;
    tx_signature: string;
    status: 'open' | 'closed';
    opened_at: Date;
    closed_at: Date | null;
    close_reason: SellReason | null;
    exit_tx_signature: string | null;
    exit_price: number | null;
    realized_profit: number | null;
    exit_amount: number | null;
    created_at: Date;
    updated_at: Date;
};

export type InsertPosition = Omit<Position, 'id' | 'opened_at' | 'created_at' | 'updated_at'>;

export type LaunchpadTokenResult = {
    id: string;
    simulation: boolean;
    chain: Blockchain;
    platform: 'pumpfun';
    mint: string;
    creator: string;
    net_pnl: number | null;
    exit_code: ExitMonitoringReason | null;
    exit_reason: string | null;
};
