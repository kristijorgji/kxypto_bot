import { LaunchpadBotStrategy } from '../../../strategies/launchpads/LaunchpadBotStrategy';
import { ExitMonitoringReason } from '../../types';

export type PumpfunBuyPositionMetadata = {
    pumpInSol: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
};

export type BuyPosition<T = Record<string, unknown>> = {
    timestamp: number;
    amountRaw: number;
    grossReceivedLamports: number;
    netTransferredLamports: number;
    price: {
        inLamports: number;
        inSol: number;
    };
    marketCap: number;
    /**
     * This is optional for troubleshooting only and should not be used in any logic
     */
    metadata?: T;
};

export type PumpfunSellPositionMetadata = {
    pumpMinLamportsOutput: number;
};

export type SellPosition<T = Record<string, unknown>> = {
    timestamp: number;
    amountRaw: number;
    grossReceivedLamports: number;
    netReceivedLamports: number; // this can be negative if the fees are higher than the gross received
    price: {
        inLamports: number;
        inSol: number;
    };
    marketCap: number;
    reason: string;
    /**
     * This is optional for troubleshooting only and should not be used in any logic
     */
    metadata?: T;
};

export type Trade = {
    buyPosition: BuyPosition;
    sellPositions: SellPosition[];
    netPnl: {
        inLamports: number;
        inSol: number;
    };
};

export type BacktestExitResponse = {
    exitCode: ExitMonitoringReason;
    exitReason: string;
};

export type BacktestTradeResponse = {
    tradeHistory: Trade[];
    finalBalanceLamports: number;
    profitLossLamports: number;
    holdings: number;
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
};

export type StrategyBacktestResult = {
    totalPnlInSol: number;
    totalRoi: number;
    totalTrades: number;
};
