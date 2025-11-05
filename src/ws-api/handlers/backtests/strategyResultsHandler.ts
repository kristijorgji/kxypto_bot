import { Logger } from 'winston';

import {
    BacktestsStrategyResultsFilters,
    fetchBacktestsStrategyResultsCursorPaginated,
} from '@src/db/repositories/backtests';
import { ProtoBacktestStrategyFullResult } from '@src/protos/generated/backtests';
import { createBacktestPubSub } from '@src/pubsub';
import { ProtoBacktestStrategyFullResultFactory } from '@src/testdata/factories/proto/backtests';
import { PlainFilters } from '@src/types/data';
import { randomInt } from '@src/utils/data/data';
import sendCursorPaginatedSnapshotResponse, {
    sendFetchMoreResponse,
    sendUpdatesResponse,
} from '@src/ws-api/utils/sendMessage';

import { FetchMoreMessage, RequestDataParams, UpdateItem, WsConnection } from '../../types';

export const BACKTESTS_STRATEGY_RESULTS_CHANNEL = 'backtests_strategy_results';
const DEFAULT_FETCH_LIMIT = 100;
const backtestsPubSub = createBacktestPubSub();

export async function handleBacktestsStrategyResultsSubscription(
    logger: Logger,
    ws: WsConnection,
    subscriptionId: string,
    params: Record<string, unknown>,
): Promise<void> {
    logger.debug(
        `handleBacktestsStrategyResultsSubscription - userId-${ws.user.userId}, id=${subscriptionId}, params %o`,
        params,
    );

    const { filters, pagination } = params as RequestDataParams<BacktestsStrategyResultsFilters>;

    ws.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
        filters,
        cursor: pagination.cursor,
        limit: pagination.limit,
        // interval: _createMockUpdatesInterval(ws, subscriptionId, 5000, filters),
        close: () => {
            backtestsPubSub.unsubscribeAllStrategyResults();
        },
    });
    logger.debug(`Subscription registered, ${subscriptionId}`);

    /**
     * Fetching and dispatching snapshot
     */
    const paginatedData = await fetchBacktestsStrategyResultsCursorPaginated(
        params as RequestDataParams<BacktestsStrategyResultsFilters>,
    );
    sendCursorPaginatedSnapshotResponse(
        ws,
        {
            event: 'snapshot',
            channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
            id: subscriptionId,
        },
        {
            data: paginatedData,
            appliedFilters: filters,
        },
        ProtoBacktestStrategyFullResult,
    );

    backtestsPubSub.subscribeAllStrategyResults((data: UpdateItem<ProtoBacktestStrategyFullResult>) => {
        sendUpdatesResponse(
            ws,
            {
                id: subscriptionId,
                event: 'update',
                channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
            },
            {
                items: [data],
            },
            ProtoBacktestStrategyFullResult,
        );
    });
}

export async function handleBacktestsStrategyResultsFetchMore(
    _logger: Logger,
    ws: WsConnection,
    subscriptionId: string,
    params: FetchMoreMessage['data'],
): Promise<void> {
    const subCtx = ws.subscriptions.get(subscriptionId)!;
    const appliedFilters = subCtx.filters as BacktestsStrategyResultsFilters;

    const paginatedData = await fetchBacktestsStrategyResultsCursorPaginated({
        filters: appliedFilters,
        pagination: {
            cursor: params.cursor,
            limit: params.limit ?? subCtx.limit ?? DEFAULT_FETCH_LIMIT,
        },
    });

    sendFetchMoreResponse(
        ws,
        {
            event: 'fetchMore',
            channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
            id: subscriptionId,
        },
        {
            paginatedData: paginatedData,
            appliedFilters: appliedFilters,
        },
        ProtoBacktestStrategyFullResult,
    );
}

/**
 * Mock live updates, dummy data
 * Example polling and sending via intervals
 */
function _createMockUpdatesInterval(
    ws: WsConnection,
    subscriptionId: string,
    intervalMs: number = 5000,
    appliedFilters?: PlainFilters,
): ReturnType<typeof setInterval> {
    return setInterval(() => {
        sendUpdatesResponse(
            ws,
            {
                id: subscriptionId,
                event: 'update',
                channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
            },
            {
                items: Array.from({ length: randomInt(1, 10) }).map(_ => {
                    const item = ProtoBacktestStrategyFullResultFactory();
                    return {
                        id: item.id.toString(),
                        data: item,
                        action: 'added',
                        version: randomInt(1, 10),
                    };
                }),
                appliedFilters: appliedFilters,
            },
            ProtoBacktestStrategyFullResult,
        );
    }, intervalMs);
}
