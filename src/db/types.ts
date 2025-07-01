import { FileStorageType } from '../core/types';
import { BacktestRunConfig } from '../trading/bots/blockchains/solana/types';
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
    name?: string | null;
    config: BacktestRunConfig;
};

export type BacktestStrategyResult = {
    id: number;
    backtest_id: string;
    strategy: string;
    strategy_id: string;
    config_variant: string;
    config: Record<string, unknown>;
    pnl_sol: number;
    holdings_value_sol: number;
    roi: number;
    win_rate: number;
    wins_count: number;
    biggest_win_percentage: number;
    losses_count: number;
    biggest_loss_percentage: number;
    total_trades_count: number;
    buy_trades_count: number;
    sell_trades_count: number;
    highest_peak_sol: number;
    lowest_trough_sol: number;
    max_drawdown_percentage: number;
    execution_time_seconds: number;
    created_at: Date;
    updated_at: Date;
};

export type BacktestStrategyMintResult = {
    id: number;
    strategy_result_id: number;
    mint: string;
    mint_file_storage_type: FileStorageType;
    mint_file_path: string;
    net_pnl_sol: number | null;
    holdings_value_sol: number | null;
    total_trades_count: number;
    buy_trades_count: number;
    sell_trades_count: number;
    roi: number | null;
    exit_code: ExitMonitoringReason | null;
    exit_reason: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
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
    id: number;
    simulation: boolean;
    chain: Blockchain;
    platform: 'pumpfun';
    mint: string;
    creator: string;
    net_pnl: number | null;
    exit_code: ExitMonitoringReason | null;
    exit_reason: string | null;
};

export type LaunchpadTokenReport = {
    id: number;
    launchpad_token_result_id: number;
    report: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
};
