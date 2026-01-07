import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import PubSub from '@src/pubsub/PubSub';
import { IpcTimeoutError } from '@src/ws-api/ipc/errors';
import { BACKTEST_COMMAND_REQUEST_CHANNEL, BaseIpcMessage } from '@src/ws-api/ipc/types';

export function sendIcpMessage<
    MData extends Omit<BaseIpcMessage, 'correlationId'> & {
        correlationId?: string;
    },
    RData = unknown,
>(
    {
        logger,
        pubsub,
        pendingDistributedRpc,
    }: {
        logger: Logger;
        pubsub: PubSub;
        pendingDistributedRpc: Record<string, (data: RData) => void>;
    },
    msg: MData,
    resolve: (value: RData) => void,
    reject: (reason?: unknown) => void,
    timeoutMs: number = 10e3,
) {
    msg.correlationId = msg.correlationId ?? uuidv4();
    const correlationId = msg.correlationId!;

    pendingDistributedRpc[correlationId] = (responseData: RData) => {
        resolve(responseData);
    };

    pubsub.publish(BACKTEST_COMMAND_REQUEST_CHANNEL, JSON.stringify(msg)).catch(err => {
        logger.error(`Failed to publish ${msg.type} request via PubSub:`, err);
        delete pendingDistributedRpc[correlationId];
        reject(err);
    });

    setTimeout(() => {
        if (pendingDistributedRpc[correlationId]) {
            delete pendingDistributedRpc[correlationId];
            reject(new IpcTimeoutError(msg.type, timeoutMs));
        }
    }, timeoutMs);
}
