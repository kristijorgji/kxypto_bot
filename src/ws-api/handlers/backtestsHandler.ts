import { Logger } from 'winston';

import {
    BacktestMintFullResult,
    BacktestsMintResultsFilters,
    fetchBacktestsMintResultsCursorPaginated,
} from '@src/db/repositories/backtests';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { ProtoFetchMoreResponse, ProtoSnapshotResponse, ProtoUpdatesPayload } from '@src/protos/generated/ws';
import { packAny } from '@src/protos/mappers/any';
import { packCursorPaginatedResponse } from '@src/protos/mappers/cursorPaginatedResponse';
import { packFilters } from '@src/protos/mappers/filters';
import { packUpdatesPayload } from '@src/protos/mappers/updatesPayload';
import { ProtoBacktestMintFullResultFactory } from '@src/testdata/factories/proto/backtests';
import { randomInt } from '@src/utils/data/data';
import sendHybridMessage from '@src/ws-api/utils/sendHybridMessage';

import {
    BaseResponse,
    DataFetchMoreResponse,
    DataSubscriptionResponse,
    DataUpdateResponse,
    FetchMoreMessage,
    RequestDataParams,
    SubscriptionContext,
    UpdateItem,
    WsConnection,
} from '../types';

export const BACKTESTS_MINT_RESULTS_CHANNEL = 'backtestsMintResults';

const DEFAULT_FETCH_LIMIT = 100;

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
    const subscriptions = ws.subscriptions;

    const { filters, pagination } = params as RequestDataParams<BacktestsMintResultsFilters>;

    const paginatedData = await fetchBacktestsMintResultsCursorPaginated(
        params as RequestDataParams<BacktestsMintResultsFilters>,
    );

    const header: BaseResponse<'snapshot'> = {
        event: 'snapshot',
        channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        id: subscriptionId,
    };

    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                snapshot: {
                    data: paginatedData,
                    appliedFilters: filters,
                },
            } satisfies DataSubscriptionResponse<CursorPaginatedResponse<BacktestMintFullResult>>),
        );
    } else {
        sendHybridMessage(
            ws,
            header,
            {
                data: packCursorPaginatedResponse(paginatedData, ProtoBacktestMintFullResult),
                appliedFilters: packFilters(filters),
            } satisfies ProtoSnapshotResponse,
            msg => ProtoSnapshotResponse.encode(msg).finish(),
        );
    }

    /**
     * Mock live updates, dummy data
     * Example polling and sending via intervals
     */
    const interval = setInterval(() => {
        const header: BaseResponse<'update'> = {
            id: subscriptionId,
            event: 'update',
            channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        };

        const updateItems: UpdateItem<BacktestMintFullResult>[] = Array.from({ length: randomInt(1, 10) }).map(_ => {
            const bmfr = ProtoBacktestMintFullResultFactory();
            return {
                id: bmfr.id.toString(),
                data: bmfr,
                action: 'added',
                version: randomInt(1, 10),
            };
        });
        if (ws.debugMode) {
            ws.send(
                JSON.stringify({
                    ...header,
                    updates: {
                        items: updateItems,
                        appliedFilters: filters,
                    },
                } satisfies DataUpdateResponse<BacktestMintFullResult>),
            );
        } else {
            sendHybridMessage(
                ws,
                header,
                packUpdatesPayload(
                    {
                        items: updateItems,
                        appliedFilters: filters,
                    },
                    item => packAny(item, ProtoBacktestMintFullResult),
                ),
                msg => ProtoUpdatesPayload.encode(msg).finish(),
            );
        }
    }, 3000);

    const subCtx: SubscriptionContext = {
        id: subscriptionId,
        channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        filters,
        cursor: pagination.cursor,
        limit: pagination.limit,
        interval,
    };

    subscriptions.set(subscriptionId, subCtx);

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

    const responseData: DataFetchMoreResponse<BacktestMintFullResult> = {
        event: 'fetchMore',
        channel: BACKTESTS_MINT_RESULTS_CHANNEL,
        id: subscriptionId,
        payload: {
            paginatedData: paginatedData,
            appliedFilters: appliedFilters,
        },
    };

    if (ws.debugMode) {
        ws.send(JSON.stringify(responseData));
    } else {
        sendHybridMessage(
            ws,
            {
                event: 'fetchMore',
                channel: BACKTESTS_MINT_RESULTS_CHANNEL,
                id: subscriptionId,
            } satisfies BaseResponse,
            {
                paginatedData: packCursorPaginatedResponse(paginatedData, ProtoBacktestMintFullResult),
                appliedFilters: packFilters(appliedFilters),
            } satisfies ProtoFetchMoreResponse,
            msg => ProtoFetchMoreResponse.encode(msg).finish(),
        );
    }
}
