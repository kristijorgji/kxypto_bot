import { Logger } from 'winston';

import { reviveDates } from '@src/utils/json';
import { SharedPluginDeps, WsPlugin } from '@src/ws-api/types';

import { BACKTEST_COMMAND_RESPONSE_CHANNEL, BaseIcpResponse } from './types';

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
        await pubsub.subscribe(BACKTEST_COMMAND_RESPONSE_CHANNEL, message => {
            let payload: BaseIcpResponse;
            try {
                payload = JSON.parse(message, reviveDates);
            } catch (err) {
                logger.error(`Invalid JSON from channel ${BACKTEST_COMMAND_RESPONSE_CHANNEL}:`, err);
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
