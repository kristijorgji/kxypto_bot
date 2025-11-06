import { Logger } from 'winston';

import { BacktestsMintResultsFilters, fetchBacktestsMintResultsCursorPaginated } from '@src/db/repositories/backtests';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { MessageFns, ProtoCursorPaginatedResponse, ProtoFetchStatus } from '@src/protos/generated/ws';
import { packCursorPaginatedResponse } from '@src/protos/mappers/cursorPaginatedResponse';
import { createBacktestPubSub } from '@src/pubsub';
import { ProtoBacktestMintFullResultFactory } from '@src/testdata/factories/proto/backtests';
import { PlainFilters } from '@src/types/data';
import { randomInt } from '@src/utils/data/data';
import { sendFetchMoreResponse, sendFetchResponse, sendUpdatesResponse } from '@src/ws-api/utils/sendMessage';

import { FetchMoreMessage, FetchRequestMessage, RequestDataParams, WsConnection } from '../../types';

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

    backtestsPubSub.subscribeAllMintsResults((data: ProtoBacktestMintFullResult) => {
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
                        id: `${data.mint}_${data.strategy_result_id}`,
                        data: data,
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
        // interval: _createMockUpdatesInterval(ws, subscriptionId, 5000, filters),
        close: () => {
            backtestsPubSub.unsubscribeAllMintsResults();
        },
    });
    logger.debug(`Subscription registered, ${subscriptionId}`);
}

export const ProtoCursorPaginatedBacktestMintResultsResponse = {
    encode: (input: CursorPaginatedResponse<ProtoBacktestMintFullResult>) =>
        ProtoCursorPaginatedResponse.encode(packCursorPaginatedResponse(input, ProtoBacktestMintFullResult)),
    decode: ProtoCursorPaginatedResponse.decode,
} as MessageFns<unknown>;

export async function handleBacktestMintResultsFetchRequest(
    _logger: Logger,
    ws: WsConnection,
    fetchRequestId: string,
    params: FetchRequestMessage['data'],
): Promise<void> {
    const { filters, pagination } = params as RequestDataParams<BacktestsMintResultsFilters>;
    const paginatedData = await fetchBacktestsMintResultsCursorPaginated({
        filters: filters,
        pagination: pagination,
    });

    sendFetchResponse(
        ws,
        {
            event: 'fetch_response',
            channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        },
        {
            requestId: fetchRequestId,
            status: ProtoFetchStatus.FETCH_STATUS_OK,
            data: paginatedData,
        },
        ProtoCursorPaginatedBacktestMintResultsResponse,
    );
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
