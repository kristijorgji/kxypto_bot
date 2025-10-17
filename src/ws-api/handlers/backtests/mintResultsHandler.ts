import { Logger } from 'winston';

import { BacktestsMintResultsFilters, fetchBacktestsMintResultsCursorPaginated } from '@src/db/repositories/backtests';
import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { createBacktestPubSub } from '@src/pubsub';
import { ProtoBacktestMintFullResultFactory } from '@src/testdata/factories/proto/backtests';
import { PlainFilters } from '@src/types/data';
import { randomInt } from '@src/utils/data/data';
import sendCursorPaginatedSnapshotResponse, {
    sendFetchMoreResponse,
    sendUpdatesResponse,
} from '@src/ws-api/utils/sendMessage';

import { FetchMoreMessage, RequestDataParams, WsConnection } from '../../types';

export const BACKTESTS_MINT_RESULTS_CHANNEL = 'backtests_mint_results';
const DEFAULT_FETCH_LIMIT = 100;
const backtestsPubSub = createBacktestPubSub();

export async function handleBacktestsMintResultsSubscription(
    logger: Logger,
    ws: WsConnection,
    subscriptionId: string,
    params: Record<string, unknown>,
): Promise<void> {
    logger.debug(
        `handleBacktestsMintResultsSubscription - userId-${ws.user.userId}, id=${subscriptionId}, params %o`,
        params,
    );

    const { filters, pagination } = params as RequestDataParams<BacktestsMintResultsFilters>;
    const paginatedData = await fetchBacktestsMintResultsCursorPaginated(
        params as RequestDataParams<BacktestsMintResultsFilters>,
    );
    sendCursorPaginatedSnapshotResponse(
        ws,
        {
            event: 'snapshot',
            channel: BACKTESTS_MINT_RESULTS_CHANNEL,
            id: subscriptionId,
        },
        {
            data: paginatedData,
            appliedFilters: filters,
        },
        ProtoBacktestMintFullResult,
    );

    backtestsPubSub.subscribeAllMintsResults(data => {
        sendUpdatesResponse(
            ws,
            {
                id: subscriptionId,
                event: 'update',
                channel: BACKTESTS_MINT_RESULTS_CHANNEL,
            },
            {
                items: [
                    {
                        // @ts-ignore
                        id: data.id,
                        /**
                         * TODO  incorrect mapping - decide on exact data type, create and use its encoder instead of ProtoBacktestMintFullResult
                         * Adjust the test interval as well
                         */
                        data: data as unknown as ProtoBacktestMintFullResult,
                        action: 'added',
                    },
                ],
            },
            ProtoBacktestMintFullResult,
        );
    });

    ws.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        filters,
        cursor: pagination.cursor,
        limit: pagination.limit,
        // interval: _createMockUpdatesInterval(ws, subscriptionId, 5000, filters),
        close: () => {
            backtestsPubSub.unsubscribeAllMintsResults();
        },
    });
    logger.debug(`Subscription registered, ${subscriptionId}`);
}

export async function handleBacktestsMintResultsFetchMore(
    _logger: Logger,
    ws: WsConnection,
    subscriptionId: string,
    params: FetchMoreMessage['data'],
): Promise<void> {
    const subCtx = ws.subscriptions.get(subscriptionId)!;
    const appliedFilters = subCtx.filters as BacktestsMintResultsFilters;

    const paginatedData = await fetchBacktestsMintResultsCursorPaginated({
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
            channel: BACKTESTS_MINT_RESULTS_CHANNEL,
            id: subscriptionId,
        },
        {
            paginatedData: paginatedData,
            appliedFilters: appliedFilters,
        },
        ProtoBacktestMintFullResult,
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
                channel: BACKTESTS_MINT_RESULTS_CHANNEL,
            },
            {
                items: Array.from({ length: randomInt(1, 10) }).map(_ => {
                    const bmfr = ProtoBacktestMintFullResultFactory();
                    return {
                        id: bmfr.id.toString(),
                        data: bmfr,
                        action: 'added',
                        version: randomInt(1, 10),
                    };
                }),
                appliedFilters: appliedFilters,
            },
            ProtoBacktestMintFullResult,
        );
    }, intervalMs);
}
