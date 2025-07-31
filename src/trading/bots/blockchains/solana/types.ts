import { z } from 'zod';

import { BondingCurveState } from '@src/blockchains/solana/dex/pumpfun/pump-base';
import { jitoConfigSchema } from '@src/blockchains/solana/Jito';
import { FileStorageType } from '@src/core/types';
import { strategyFileConfigSchema } from '@src/trading/config/types';

import LaunchpadBotStrategy from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { HistoryEntry } from '../../launchpads/types';
import {
    BotManagerConfig,
    ExitMonitoringReason,
    SellReason,
    SwapSubCategory,
    TransactionType,
    botManagerConfigSchema,
} from '../../types';

export type SolanaValue = {
    inLamports: number;
    inSol: number;
};

export type PumpfunPositionMeta =
    | {
          startActionBondingCurveState: BondingCurveState;
          price: {
              calculationMode: 'txGrossTransferred' | 'bondingCurveTransferred';
              fromTxGrossTransferredInSol: number;
              fromBondingCurveTransferredInSol: number;
          };
      }
    | {
          startActionBondingCurveState: BondingCurveState;
          price: {
              calculationMode: 'simulation';
          };
      };

export type PumpfunBuyPositionMetadata = {
    pumpInSol: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
    pumpBuyPriceInSol: number;
    pumpMeta?: PumpfunPositionMeta;
    buyRes: {
        reason: string;
        data?: Record<string, unknown>;
    };
};

export type PumpfunSellPositionMetadata = {
    pumpMinLamportsOutput: number;
    reason: SellReason;
    sellPriceInSol: number;
    pumpMeta?: PumpfunPositionMeta;
    sellRes: {
        reason: string;
        data?: Record<string, unknown>;
    };
};

export type HistoryRef = {
    timestamp: number;
    index: number;
};

type TradeOrigin = {
    historyRef: HistoryRef;
    historyEntry: HistoryEntry;
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
    metadata?: TradeOrigin & T;
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

export type HandlePumpTokenBaseReport = {
    /**
     * This information is used to understand the content of this report
     * As it changes it is mandatory to document what version we stored for every report
     */
    $schema: {
        version: number;
        name?: string;
    };
    simulation: boolean;
    rpcProvider: {
        name?: string;
        domain: string;
    };
    mint: string;
    name: string;
    url: string;
    bullXUrl: string;
    creator: string;
    startedAt: Date;
    endedAt: Date;
    elapsedSeconds: number;
};

export type HandlePumpTokenExitReport = HandlePumpTokenBaseReport & {
    exitCode: 'BAD_CREATOR';
    exitReason: string;
};

export type HandlePumpTokenBotReport = HandlePumpTokenBaseReport & {
    strategy: {
        id: string;
        name: string;
        configVariant: string;
    };
    monitor: {
        buyTimeframeMs: number;
        sellTimeframeMs: number;
    };
} & BotResponse;

export type HandlePumpTokenReport = HandlePumpTokenExitReport | HandlePumpTokenBotReport;

export type PumpfunBotConfig = {
    runConfig: BotManagerConfig;
    strategyFactory: () => LaunchpadBotStrategy;
};

export const pumpfunBotFileConfigSchema = z.object({
    runConfig: botManagerConfigSchema.omit({
        reportSchema: true,
    }),
    strategy: strategyFileConfigSchema,
});
export type PumpfunBotFileConfig = z.infer<typeof pumpfunBotFileConfigSchema>;

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

export const backtestStrategyRunConfigSchema = z.object({
    /**
     * The initial balance for the backtest, denominated in lamports (1 SOL = 1,000,000,000 lamports).
     */
    initialBalanceLamports: z.number().positive(),

    /**
     * The amount of SOL to allocate for each buy transaction during the simulation.
     */
    buyAmountSol: z.number().positive(),

    /**
     * Configuration settings related to Jito.
     */
    jitoConfig: jitoConfigSchema,

    /**
     * The trading strategy to be used in the backtest.
     */
    strategy: z.instanceof(LaunchpadBotStrategy),

    /**
     * Configuration for introducing random variations during simulation to better mimic real-world market conditions.
     */
    randomization: z.object({
        /**
         * If `true`, introduces random variations in buy and sell priority fees,
         * within the provided priority fee intervals.
         */
        priorityFees: z.boolean(),

        /**
         * Controls how slippage values are selected during the simulation:
         * - `'off'`: Use the exact provided slippage values.
         * - `'randomized'`: Randomize slippage within the provided buy and sell slippage intervals.
         * - `'closestEntry'`: Use the closest available price value from the historical dataset or predefined entries after simulating buy or execution times.
         */
        slippages: z.enum(['off', 'randomized', 'closestEntry']),

        /**
         * If `true`, introduces random variations in buy and sell execution times
         * to simulate real-world delays.
         */
        execution: z.boolean(),
    }),

    /**
     * If `true`, the simulation will exit after completing a single buy-sell trade cycle.
     */
    onlyOneFullTrade: z.boolean(),

    /**
     * If `true`, the simulation will automatically sell all remaining open positions
     * at the final timestamp of the historical data. This ensures that all trades
     * are closed by the end of the backtest.
     */
    sellUnclosedPositionsAtEnd: z.boolean(),
});
/**
 * Configuration options for running a backtest simulation for a particular strategy.
 */
export type BacktestStrategyRunConfig = z.infer<typeof backtestStrategyRunConfigSchema>;

export const backtestRunConfigSchema = backtestStrategyRunConfigSchema
    .omit({
        strategy: true,
    })
    .merge(
        z.object({
            data: z.object({
                path: z.string(),
                filesCount: z.number().positive(),
                /**
                 * If one of the provided includes matches, the file is included
                 */
                includeIfPathContains: z.array(z.string()).optional(),
            }),
        }),
    );
export type BacktestRunConfig = z.infer<typeof backtestRunConfigSchema>;

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
