import { Logger } from 'winston';

import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { createBacktestPubSub } from '@src/pubsub';
import { UpdateItem, WsConnection } from '@src/ws-api/types';
import { sendUpdatesResponse } from '@src/ws-api/utils/sendMessage';

export const BACKTESTS_RUNS_CHANNEL = 'backtest_runs';
const backtestsPubSub = createBacktestPubSub();

export async function handleBacktestRunsSubscription(
    logger: Logger,
    ws: WsConnection,
    subscriptionId: string,
): Promise<void> {
    logger.debug(`handleBacktestRunsSubscription - userId-${ws.user.userId}, id=${subscriptionId}, params %o`);

    backtestsPubSub.subscribeAllRuns((data: UpdateItem<ProtoBacktestRun>) => {
        sendUpdatesResponse(
            ws,
            {
                id: subscriptionId,
                event: 'update',
                channel: BACKTESTS_RUNS_CHANNEL,
            },
            {
                items: [data],
            },
            ProtoBacktestRun,
        );
    });

    ws.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        channel: BACKTESTS_RUNS_CHANNEL,
        close: () => {
            backtestsPubSub.unsubscribeAllRuns();
        },
    });
    logger.debug(`Subscription registered, ${subscriptionId}`);
}
