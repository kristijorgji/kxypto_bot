import { Logger } from 'winston';
import { RawData } from 'ws';
import { z } from 'zod';

import PubSub from '@src/pubsub/PubSub';
import { BACKTESTS_RUNS_CHANNEL, handleBacktestRunsSubscription } from '@src/ws-api/handlers/backtests/runsHandler';
import {
    BACKTESTS_STRATEGY_RESULTS_CHANNEL,
    handleBacktestsStrategyResultsFetchMore,
    handleBacktestsStrategyResultsSubscription,
} from '@src/ws-api/handlers/backtests/strategyResultsHandler';
import { handleRpcEvent } from '@src/ws-api/handlers/rpc/handleRpcEvent';

import {
    BACKTESTS_MINT_RESULTS_CHANNEL,
    handleBacktestMintResultsFetchRequest,
    handleBacktestsMintResultsFetchMore,
    handleBacktestsMintResultsSubscription,
} from './handlers/backtests/mintResultsHandler';
import {
    FetchMoreMessage,
    FetchRequestMessage,
    SubscribeMessage,
    SubscriptionContext,
    UnsubscribeMessage,
    WsConnection,
    WsMessage,
    baseMessageSchema,
    rpcMessageSchema,
} from './types';

const inputSchema = z.union([baseMessageSchema.passthrough(), rpcMessageSchema(z.unknown()).passthrough()]);

export async function handleMessage(
    logger: Logger,
    ws: WsConnection,
    rawData: Buffer | string | RawData,
    deps: {
        pubsub: PubSub;
        pendingDistributedRpc: Record<string, (data: unknown) => void>;
    },
): Promise<void> {
    let msg: WsMessage;

    let msgAsObject: unknown;
    try {
        msgAsObject = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString());
    } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        return;
    }

    const parsed = inputSchema.safeParse(msgAsObject);
    if (!parsed.success) {
        ws.send(
            JSON.stringify({
                event: 'error',
                error: 'Invalid message format',
                message: 'The incoming WebSocket message does not match the expected schema.',
                issues: parsed.error.issues.map(issue => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                    code: issue.code,
                })),
            }),
        );
        return;
    }
    msg = parsed.data as WsMessage;

    if (!msg.id) {
        ws.send(JSON.stringify({ error: 'Missing identifier(id) used for subscription|fetch|rpc' }));
        return;
    }

    if (msg.event === 'subscribe') {
        return handleSubscribeEvent(logger, ws, msg);
    } else if (msg.event === 'fetchMore') {
        return handleFetchMoreEvent(logger, ws, msg);
    } else if (msg.event === 'fetch') {
        return handleFetchEvent(logger, ws, msg);
    } else if (msg.event === 'unsubscribe') {
        return handleUnsubscribeEvent(logger, ws, msg);
    } else if (msg.event === 'rpc') {
        return handleRpcEvent(logger, ws, msg, deps);
    } else {
        logger.warn('Unknown event type in message: %o', msg);
    }
}

async function handleSubscribeEvent(logger: Logger, ws: WsConnection, msg: SubscribeMessage): Promise<void> {
    switch (msg.channel) {
        case BACKTESTS_RUNS_CHANNEL:
            return handleBacktestRunsSubscription(logger, ws, msg.id);
        case BACKTESTS_STRATEGY_RESULTS_CHANNEL:
            return handleBacktestsStrategyResultsSubscription(logger, ws, msg.id, msg.data);
        case BACKTESTS_MINT_RESULTS_CHANNEL:
            return handleBacktestsMintResultsSubscription(logger, ws, msg.id, msg.data);
        default:
            ws.send(JSON.stringify({ error: `Unknown channel : ${msg.channel}` }));
            return;
    }
}

async function handleFetchMoreEvent(logger: Logger, ws: WsConnection, msg: FetchMoreMessage): Promise<void> {
    switch (msg.channel) {
        case BACKTESTS_STRATEGY_RESULTS_CHANNEL:
            return handleBacktestsStrategyResultsFetchMore(logger, ws, msg.id, msg.data);
        case BACKTESTS_MINT_RESULTS_CHANNEL:
            return handleBacktestsMintResultsFetchMore(logger, ws, msg.id, msg.data);
        default:
            ws.send(JSON.stringify({ error: `Unknown channel : ${msg.channel}` }));
            return;
    }
}

async function handleFetchEvent(logger: Logger, ws: WsConnection, msg: FetchRequestMessage): Promise<void> {
    switch (msg.channel) {
        case BACKTESTS_MINT_RESULTS_CHANNEL:
            return handleBacktestMintResultsFetchRequest(logger, ws, msg.id, msg.data);
        default:
            ws.send(JSON.stringify({ error: `Unknown channel : ${msg.channel} for event ${msg.event}` }));
            return;
    }
}

async function handleUnsubscribeEvent(logger: Logger, ws: WsConnection, msg: UnsubscribeMessage): Promise<void> {
    if (msg.id) {
        const sub = ws.subscriptions.get(msg.id);
        if (sub) {
            await closeSubscription(sub);
            ws.subscriptions.delete(msg.id);
        }
        logger.debug(`Unsubscribed ${msg.id} (${msg.channel})`);
    } else if (msg.channel) {
        const unsubscribedIds: string[] = [];

        for (const subscription of ws.subscriptions.values()) {
            if (subscription.channel === msg.channel) {
                await closeSubscription(subscription);
                unsubscribedIds.push(subscription.id);
                ws.subscriptions.delete(subscription.id);
            }
        }

        logger.debug(`Unsubscribed all subscriptions: [${unsubscribedIds.join(',')}] of channel ${msg.channel}`);
    } else {
        ws.send(JSON.stringify({ error: 'Unsubscribe message must have either subscription id or channel' }));
    }
}

export async function closeSubscription(sub: SubscriptionContext): Promise<void> {
    if (sub.interval) {
        clearInterval(sub.interval);
    }

    if (sub.close) {
        await sub.close();
    }
}
