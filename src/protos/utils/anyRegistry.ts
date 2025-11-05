import {
    ProtoBacktestMintFullResult,
    ProtoBacktestMintResultDraft,
    ProtoBacktestStrategyFullResult,
} from '@src/protos/generated/backtests';
import { AnyRegistryManager } from '@src/protos/utils/AnyRegistryManager';
import { ProtoCursorPaginatedBacktestMintResultsResponse } from '@src/ws-api/handlers/backtests/mintResultsHandler';

/**
 * Default registry: populate with your known types
 */
export const DEFAULT_ANY_REGISTRY = new AnyRegistryManager({
    'type.googleapis.com/ws.ProtoBacktestStrategyFullResult': ProtoBacktestStrategyFullResult,
    'type.googleapis.com/ws.ProtoBacktestMintResultDraft': ProtoBacktestMintResultDraft,
    'type.googleapis.com/ws.ProtoBacktestMintFullResult': ProtoBacktestMintFullResult,
    'type.googleapis.com/ws.CursorPaginatedBacktestMintResultsResponse':
        ProtoCursorPaginatedBacktestMintResultsResponse,
});
