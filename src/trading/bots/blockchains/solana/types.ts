import { JitoConfig } from '../../../../blockchains/solana/Jito';
import { FileStorageType } from '../../../../core/types';
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
    pumpBuyPriceInSol: number;
};

export type PumpfunSellPositionMetadata = {
    pumpMinLamportsOutput: number;
    reason: SellReason;
    sellPriceInSol: number;
};

export type HistoryRef = {
    timestamp: number;
    index: number;
};

export type BacktestTradeOrigin = {
    historyRef: HistoryRef;
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
    maxDrawdownPercentage: number;
    roi: number;
};

export type BacktestResponse = BacktestExitResponse | BacktestTradeResponse;

/**
 * Configuration options for running a backtest simulation for a particular strategy.
 */
export type BacktestStrategyRunConfig = {
    /**
     * The initial balance for the backtest, denominated in lamports (1 SOL = 1,000,000,000 lamports).
     */
    initialBalanceLamports: number;

    /**
     * The amount of SOL to allocate for each buy transaction during the simulation.
     */
    buyAmountSol: number;

    /**
     * Configuration settings related to Jito.
     */
    jitoConfig: JitoConfig;

    /**
     * The trading strategy to be used in the backtest.
     */
    strategy: LaunchpadBotStrategy;

    /**
     * Configuration for introducing random variations during simulation to better mimic real-world market conditions.
     */
    randomization: {
        /**
         * If `true`, introduces random variations in buy and sell priority fees,
         * within the provided priority fee intervals.
         */
        priorityFees: boolean;

        /**
         * Controls how slippage values are selected during the simulation:
         * - `'off'`: Use the exact provided slippage values.
         * - `'randomized'`: Randomize slippage within the provided buy and sell slippage intervals.
         * - `'closestEntry'`: Use the closest available price value from the historical dataset or predefined entries after simulating buy or execution times.
         */
        slippages: 'off' | 'randomized' | 'closestEntry';

        /**
         * If `true`, introduces random variations in buy and sell execution times
         * to simulate real-world delays.
         */
        execution: boolean;
    };

    /**
     * If `true`, the simulation will exit after completing a single buy-sell trade cycle.
     */
    onlyOneFullTrade: boolean;

    /**
     * If `true`, the simulation will automatically sell all remaining open positions
     * at the final timestamp of the historical data. This ensures that all trades
     * are closed by the end of the backtest.
     */
    sellUnclosedPositionsAtEnd: boolean;
};

export type BacktestRunConfig = Omit<BacktestStrategyRunConfig, 'strategy'> & {
    data: {
        path: string;
        filesCount: number;
        /**
         * If one of the provided includes matches, the file is included
         */
        includeIfPathContains?: string[];
    };
};

export type StrategyMintBacktestResult = {
    mintFileStorageType: FileStorageType;
    mintFilePath: string;
    backtestResponse: BacktestResponse;
};

export type StrategyBacktestResult = {
    totalPnlInSol: number;
    finalBalanceLamports: number;
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
    highestPeakLamports: number;
    lowestTroughLamports: number;
    maxDrawdownPercentage: number;
    mintResults: Record<string, StrategyMintBacktestResult>;
};
