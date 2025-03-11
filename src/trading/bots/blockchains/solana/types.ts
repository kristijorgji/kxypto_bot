import LaunchpadBotStrategy from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { HistoryEntry } from '../../launchpads/types';
import { ExitMonitoringReason, SellReason, SwapSubCategory, TransactionType } from '../../types';

export type SolanaValue = {
    inLamports: number;
    inSol: number;
};

export type PumpfunBuyPositionMetadata = {
    pumpInSol: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
};

export type PumpfunSellPositionMetadata = {
    pumpMinLamportsOutput: number;
    reason: SellReason;
};

export type BoughtSold = {
    address: string;
    name: string;
    symbol: string;
    amount: number;
};

export type TradeTransaction<T = Record<string, unknown>> = {
    timestamp: number;
    transactionType: TransactionType;
    subCategory: SwapSubCategory;
    transactionHash: string;
    walletAddress: string;
    bought: BoughtSold;
    sold: BoughtSold;
    amountRaw: number;
    /**
     * This will be negative for buy transactions and positive for sale
     */
    grossTransferredLamports: number;
    /**
     * This can be either positive or negative as it includes the fees as well
     */
    netTransferredLamports: number;
    price: SolanaValue;
    marketCap: number;
    /**
     * This is optional for troubleshooting only and should not be used in any logic
     */
    metadata?: T;
};

export type BotTradeResponse = {
    netPnl: SolanaValue;
    transactions: TradeTransaction[];
    history: HistoryEntry[];
};

export type BotExitResponse = {
    exitCode: ExitMonitoringReason;
    exitReason: string;
    history: HistoryEntry[];
};

export type BotResponse = BotTradeResponse | BotExitResponse;

export type BacktestExitResponse = {
    exitCode: ExitMonitoringReason;
    exitReason: string;
};

export type BacktestTradeResponse = {
    tradeHistory: TradeTransaction[];
    finalBalanceLamports: number;
    profitLossLamports: number;
    holdings: {
        amountRaw: number;
        lamportsValue: number;
    };
    maxDrawdown: number;
    roi: number;
};

export type BacktestRunConfig = {
    initialBalanceLamports: number;
    buyAmountSol: number;
    strategy: LaunchpadBotStrategy;
    /**
     * if this is true the simulation will exit after one buy - trade pair
     */
    onlyOneFullTrade: boolean;
    /**
     * if this is true the simulation will continue with the next file resetting the initial balance
     */
    allowNegativeBalance: boolean;
};

export type StrategyBacktestResult = {
    totalPnlInSol: number;
    totalHoldingsValueInSol: number;
    totalRoi: number;
    totalTradesCount: number;
    totalBuyTradesCount: number;
    totalSellTradesCount: number;
    winRatePercentage: number;
    winsCount: number;
    /**
     * This value is calculated relative to the amount used to buy
     */
    biggestWinPercentage: number;
    lossesCount: number;
    /**
     * This value is calculated relative to the amount used to buy
     */
    biggestLossPercentage: number;
};
