import { Logger } from 'winston';
import { RawData } from 'ws';

import {
    BACKTESTS_MINT_RESULTS_CHANNEL,
    handleBacktestsMintResultsFetchMore,
    handleBacktestsMintResultsSubscription,
} from './handlers/backtestsHandler';
import { FetchMoreMessage, SubscribeMessage, UnsubscribeMessage, WsConnection, WsMessage } from './types';

export async function handleMessage(
    logger: Logger,
    ws: WsConnection,
    rawData: Buffer | string | RawData,
): Promise<void> {
    let msg: WsMessage;
    try {
        if (typeof rawData === 'string') {
            msg = JSON.parse(rawData);
        } else {
            msg = JSON.parse(rawData.toString());
        }
    } catch (_) {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        return;
    }

    if (!msg.id) {
        ws.send(JSON.stringify({ error: 'Missing subscription ID (id)' }));
        return;
    }

    if (msg.event === 'subscribe') {
        return handleSubscribeEvent(logger, ws, msg);
    } else if (msg.event === 'fetchMore') {
        return handleFetchMoreEvent(logger, ws, msg);
    } else if (msg.event === 'unsubscribe') {
        return handleUnsubscribeEvent(logger, ws, msg);
    }
}

async function handleSubscribeEvent(logger: Logger, ws: WsConnection, msg: SubscribeMessage): Promise<void> {
    switch (msg.channel) {
        case BACKTESTS_MINT_RESULTS_CHANNEL:
            return handleBacktestsMintResultsSubscription(logger, ws, msg.id, msg.data);
        default:
            ws.send(JSON.stringify({ error: `Unknown channel : ${msg.channel}` }));
            return;
    }
}

async function handleFetchMoreEvent(logger: Logger, ws: WsConnection, msg: FetchMoreMessage): Promise<void> {
    switch (msg.channel) {
        case BACKTESTS_MINT_RESULTS_CHANNEL:
            return handleBacktestsMintResultsFetchMore(logger, ws, msg.id, msg.data);
        default:
            ws.send(JSON.stringify({ error: `Unknown channel : ${msg.channel}` }));
            return;
    }
}

async function handleUnsubscribeEvent(logger: Logger, ws: WsConnection, msg: UnsubscribeMessage): Promise<void> {
    const sub = ws.subscriptions.get(msg.id);
    if (sub?.interval) clearInterval(sub.interval);
    ws.subscriptions.delete(msg.id);

    logger.debug(`Unsubscribed ${msg.id} (${msg.channel})`);
}
