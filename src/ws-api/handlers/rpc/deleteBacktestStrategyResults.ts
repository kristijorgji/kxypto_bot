import { z } from 'zod';

import { deleteBacktestStrategyResultsById } from '@src/db/repositories/backtests';
import { ProtoDeleteBacktestStrategyResultsResponseMessage } from '@src/protos/generated/backtests';
import { RpcHandler } from '@src/ws-api/types';

export const deleteBacktestStrategyResults: RpcHandler<
    { backtestId: string },
    ProtoDeleteBacktestStrategyResultsResponseMessage
> = {
    schema: z.object({
        backtestId: z.string().uuid(),
    }),

    successDataProtoClass: ProtoDeleteBacktestStrategyResultsResponseMessage,

    async run(data) {
        const { backtestId } = data;

        return await deleteBacktestStrategyResultsById(backtestId);
    },
};
