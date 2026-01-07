import { z } from 'zod';

import { ProtoBacktestStrategyResultStatusResponseMessage } from '@src/protos/generated/backtests';
import { sendIcpMessage } from '@src/ws-api/ipc/client';
import { BacktestStrategyResultStatusRequestMessage } from '@src/ws-api/ipc/types';
import { RpcHandler } from '@src/ws-api/types';

export const getBacktestStrategyResultStatus: RpcHandler<
    { strategyResultId: number },
    ProtoBacktestStrategyResultStatusResponseMessage
> = {
    schema: z.object({
        strategyResultId: z.number().positive(),
    }),

    successDataProtoClass: ProtoBacktestStrategyResultStatusResponseMessage,

    async run(data, ctx) {
        const { strategyResultId } = data;

        return new Promise<ProtoBacktestStrategyResultStatusResponseMessage>((resolve, reject) => {
            sendIcpMessage(
                ctx,
                {
                    type: 'STRATEGY_RESULT_STATUS_REQUEST',
                    strategyResultId,
                } satisfies Omit<BacktestStrategyResultStatusRequestMessage, 'correlationId'>,
                resolve,
                reject,
                10e3,
            );
        });
    },
};
