import { getBacktestStrategyResultStatus } from '@src/ws-api/handlers/rpc/getBacktestStrategyResultStatus';
import { RpcHandler } from '@src/ws-api/types';

/**
 * Central registry for all RPC methods exposed over WebSocket.
 *
 * Maps:
 *     methodName → handler implementation
 *
 * The router uses this table to:
 *  - look up the correct RPC handler
 *  - run validation
 *  - execute logic
 *  - generate rpc_response messages
 */
export const rpcRegistry: Record<string, RpcHandler<unknown, unknown>> = {
    get_backtest_strategy_result_status: getBacktestStrategyResultStatus,
    // add more RPC endpoints here...
} as const;
