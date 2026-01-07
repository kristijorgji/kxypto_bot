import { z } from 'zod';

import { abortBacktestRunById, deleteBacktestRunById } from '@src/db/repositories/backtests';
import {
    ProtoAbortBacktestRunResponseMessage,
    ProtoDeleteBacktestRunResponseMessage,
} from '@src/protos/generated/backtests';
import { sendIcpMessage } from '@src/ws-api/ipc/client';
import { IpcTimeoutError } from '@src/ws-api/ipc/errors';
import { BacktestRunAbortRequestMessage } from '@src/ws-api/ipc/types';
import { RpcHandler } from '@src/ws-api/types';

export const cancelBacktestRun: RpcHandler<{ backtestRunId: number }, ProtoAbortBacktestRunResponseMessage> = {
    schema: z.object({
        backtestRunId: z.number().positive(),
    }),

    successDataProtoClass: ProtoAbortBacktestRunResponseMessage,

    async run(data, ctx) {
        const { backtestRunId } = data;

        return new Promise<ProtoAbortBacktestRunResponseMessage>((resolve, reject) => {
            sendIcpMessage(
                ctx,
                {
                    type: 'BACKTEST_RUN_ABORT',
                    backtestRunId,
                } satisfies Omit<BacktestRunAbortRequestMessage, 'correlationId'>,
                resolve,
                async reason => {
                    if (reason instanceof IpcTimeoutError) {
                        /**
                         * abort manually because most likely process is not running anymore
                         * and is stopped abruptly in the past
                         */
                        resolve(await abortBacktestRunById(backtestRunId));
                    } else {
                        reject(reason);
                    }
                },
                10e3,
            );
        });
    },
};

export const deleteBacktestRun: RpcHandler<{ backtestRunId: number }, ProtoDeleteBacktestRunResponseMessage> = {
    schema: z.object({
        backtestRunId: z.number().positive(),
    }),

    successDataProtoClass: ProtoDeleteBacktestRunResponseMessage,

    async run(data) {
        const { backtestRunId } = data;

        return await deleteBacktestRunById(backtestRunId);
    },
};
