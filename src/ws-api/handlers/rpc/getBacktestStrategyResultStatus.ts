import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { ProtoBacktestStrategyResultStatusResponseMessage } from '@src/protos/generated/backtests';
import {
    BACKTEST_COMMAND_CHANNEL,
    BacktestStrategyResultStatusRequestMessage,
    BacktestStrategyResultStatusResponseMessage,
} from '@src/ws-api/ipc/types';
import { RpcHandler } from '@src/ws-api/types';

export const getBacktestStrategyResultStatus: RpcHandler<
    { strategyResultId: number },
    BacktestStrategyResultStatusResponseMessage
> = {
    schema: z.object({
        strategyResultId: z.number().positive(),
    }),

    successDataProtoClass: ProtoBacktestStrategyResultStatusResponseMessage,

    async run(data, ctx) {
        const { strategyResultId } = data;
        const { logger, pubsub, pendingDistributedRpc } = ctx;

        logger.debug(`RPC getBacktestStrategyResultStatus for ${strategyResultId}`);

        const correlationId = uuidv4();

        return new Promise<BacktestStrategyResultStatusResponseMessage>((resolve, reject) => {
            pendingDistributedRpc[correlationId] = (responseData: unknown) => {
                resolve({
                    correlationId,
                    strategyResultId,
                    ...(responseData as Omit<
                        BacktestStrategyResultStatusResponseMessage,
                        'correlationId' | 'strategyResultId'
                    >),
                });
            };

            const msg: BacktestStrategyResultStatusRequestMessage = {
                type: 'STRATEGY_RESULT_STATUS_REQUEST',
                correlationId,
                strategyResultId,
            };

            pubsub.publish(BACKTEST_COMMAND_CHANNEL, JSON.stringify(msg)).catch(err => {
                logger.error('Failed to publish backtest status request via PubSub:', err);
                delete pendingDistributedRpc[correlationId];
                reject(err);
            });

            setTimeout(() => {
                if (pendingDistributedRpc[correlationId]) {
                    delete pendingDistributedRpc[correlationId];
                    reject(new Error('Backtest strategy result status worker timeout'));
                }
            }, 10_000);
        });
    },
};
