import {
    ProtoBacktestMintFullResult,
    ProtoBacktestRun,
    ProtoBacktestStrategyFullResult,
    ProtoBacktestStrategyResultStatusResponseMessage,
    ProtoDeleteBacktestStrategyResultsResponseMessage,
} from '@src/protos/generated/backtests';
import { AnyRegistryManager } from '@src/protos/utils/AnyRegistryManager';
import { ProtoCursorPaginatedBacktestMintResultsResponse } from '@src/ws-api/handlers/backtests/mintResultsHandler';

/**
 * Default registry: populate with your known types
 */
export const DEFAULT_ANY_REGISTRY = new AnyRegistryManager({
    'type.googleapis.com/ws.ProtoBacktestRun': ProtoBacktestRun,
    'type.googleapis.com/ws.ProtoBacktestStrategyFullResult': ProtoBacktestStrategyFullResult,
    'type.googleapis.com/ws.ProtoBacktestMintFullResult': ProtoBacktestMintFullResult,
    'type.googleapis.com/ws.CursorPaginatedBacktestMintResultsResponse':
        ProtoCursorPaginatedBacktestMintResultsResponse,
    'type.googleapis.com/ws.BacktestStrategyResultStatusResponseMessage':
        ProtoBacktestStrategyResultStatusResponseMessage,
    'type.googleapis.com/ws.ProtoDeleteBacktestStrategyResultsResponseMessage':
        ProtoDeleteBacktestStrategyResultsResponseMessage,
});
