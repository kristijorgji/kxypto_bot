import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { AnyRegistryManager } from '@src/protos/utils/AnyRegistryManager';

/**
 * Default registry: populate with your known types
 */
export const DEFAULT_ANY_REGISTRY = new AnyRegistryManager({
    'type.googleapis.com/ws.BacktestMintFullResult': ProtoBacktestMintFullResult,
});
