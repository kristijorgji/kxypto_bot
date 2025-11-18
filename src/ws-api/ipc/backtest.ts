import { Logger } from 'winston';

import { SharedPluginDeps, WsPlugin } from '@src/ws-api/types';

import { BACKTEST_STATUS_RESPONSE_CHANNEL, BacktestStrategyResultStatusResponseMessage } from './types';

const PluginName = 'backtest-ipc';
const LoggerKeyName = `${PluginName}Logger`;

export const backtestIpcPlugin: WsPlugin<{ [LoggerKeyName]: Logger }, SharedPluginDeps> = {
    name: PluginName,

    async setup({ logger }) {
        return {
            [LoggerKeyName]: logger.child({ plugin: PluginName }),
        };
    },

    async start({ pubsub, pendingDistributedRpc, [LoggerKeyName]: logger }) {
        await pubsub.subscribe(BACKTEST_STATUS_RESPONSE_CHANNEL, message => {
            let payload: BacktestStrategyResultStatusResponseMessage;
            try {
                payload = JSON.parse(message);
            } catch (err) {
                logger.error('Invalid JSON from backtest status response:', err);
                return;
            }

            const { correlationId, ...rest } = payload;
            const resolver = pendingDistributedRpc[correlationId];
            if (!resolver) {
                logger.warn('No pending RPC for correlationId', correlationId);
                return;
            }

            delete pendingDistributedRpc[correlationId];
            resolver(rest); // rest contains result data
        });
    },
};
