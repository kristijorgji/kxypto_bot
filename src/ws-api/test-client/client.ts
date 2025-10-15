import '@src/core/loadEnv';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

import { BacktestMintFullResult } from '@src/db/repositories/backtests';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { logger } from '@src/logger';
import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { ProtoFetchMoreResponse, ProtoSnapshotResponse, ProtoUpdatesPayload } from '@src/protos/generated/ws';
import { unpackAny } from '@src/protos/mappers/any';
import { decodeCursorPaginatedResponse } from '@src/protos/mappers/cursorPaginatedResponse';
import { unpackFilters } from '@src/protos/mappers/filters';
import { unpackUpdatesPayload } from '@src/protos/mappers/updatesPayload';
import { parseHybridMessage } from '@src/protos/utils/hybridMessage';
import { BACKTESTS_MINT_RESULTS_CHANNEL } from '@src/ws-api/handlers/backtestsHandler';
import {
    BaseResponse,
    DataFetchMoreResponse,
    DataSubscriptionResponse,
    DataUpdateResponse,
    FetchMoreMessage,
    ResponseEventType,
    SubscribeMessage,
} from '@src/ws-api/types';

const encoding: 'proto' | 'json' = 'proto';

const tokenBearer =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlblR5cGUiOiJhY2Nlc3MiLCJ1c2VySWQiOiI2ZjVlZWU2My1lNTBjLTRmMDYtYjJkNi02NTU5ZTE1ZGIxNDYiLCJpYXQiOjE3NTIzMTQ2MzMsImV4cCI6MTc2MzExNDYzMywiaXNzIjoia3h5cHRvX2JvdCJ9.LLP_MPIvU4-IDmLpEmQxVvE26Hr0YvfoiEgnWagRHdg';

/**
 * Example code to test the websocket server
 */
async function main() {
    const qp = new URLSearchParams();
    if (encoding === 'json') {
        qp.set('debug', 'json');
    }
    const qpString = Array.from(qp.entries()).length === 0 ? '' : `?${qp.toString()}`;
    const ws = new WebSocket(`ws://localhost:${process.env.APP_WS_PORT}/ws${qpString}`, {
        headers: {
            Authorization: `Bearer ${tokenBearer}`,
        },
    });

    const backtestsMintResultsSubscriptionId = `bmr_${uuidv4()}`;
    const fetchLimit = 50;
    const receivedBacktestMintResultIds: Set<string> = new Set();

    ws.on('open', () => {
        logger.debug(`✅ Connected to WS ${ws.url} using ${encoding} encoding`);

        const message: SubscribeMessage = {
            id: backtestsMintResultsSubscriptionId,
            event: 'subscribe',
            channel: BACKTESTS_MINT_RESULTS_CHANNEL,
            data: {
                filters: {
                    chain: 'solana',
                    backtestName: '1000_sol_1_buy_randomized_ast_13640f',
                    strategyId: 'BuyPredictionStrategy_a8d5211f',
                    tradesOnly: true,
                    tradeOutcome: 'win',
                },
                pagination: {
                    limit: fetchLimit,
                },
            },
        };

        ws.send(JSON.stringify(message));
        logger.debug('📨 Sent subscription message: %o', message);
    });

    ws.on('message', (data: Buffer) => {
        logger.debug(`Received ${encoding} message from server`);

        try {
            let header: BaseResponse;
            /**
             * Will be filled if encoding is proto
             */
            let protoPayloadBuffer: Buffer | undefined;
            /**
             * Filled if encoding is json
             */
            let jsonData: Record<string, unknown> | undefined;

            if (encoding === 'json') {
                jsonData = JSON.parse(data.toString());
                header = {
                    id: jsonData!.id as string,
                    event: jsonData!.event as ResponseEventType,
                    channel: jsonData!.channel as string,
                };
            } else {
                const hybridMessage = parseHybridMessage<BaseResponse>(data);
                header = hybridMessage.header;
                protoPayloadBuffer = hybridMessage.payloadBuffer!;
            }

            logger.debug('Header: %o', header);

            if (header.channel === BACKTESTS_MINT_RESULTS_CHANNEL) {
                if (header.event === 'snapshot') {
                    let parsedSnapshot: DataSubscriptionResponse<
                        CursorPaginatedResponse<ProtoBacktestMintFullResult>
                    >['snapshot'];

                    if (encoding === 'proto') {
                        const snapshot = ProtoSnapshotResponse.decode(protoPayloadBuffer!);
                        parsedSnapshot = {
                            data: decodeCursorPaginatedResponse(snapshot.data!, ProtoBacktestMintFullResult.decode)!,
                            appliedFilters: unpackFilters(snapshot.appliedFilters),
                        };
                    } else {
                        parsedSnapshot = jsonData!.snapshot as typeof parsedSnapshot;
                    }

                    logger.debug('[%s][%s] parsedSnapshot %o', header.channel, header.id, parsedSnapshot);

                    assertIdUniqueness(parsedSnapshot.data.data, 'id', receivedBacktestMintResultIds);

                    checkAndFetchMoreBacktestMintResultsData(parsedSnapshot.data.nextCursor);
                } else if (header.event === 'fetchMore') {
                    let parsedPayload: DataFetchMoreResponse<ProtoBacktestMintFullResult>['payload'];

                    if (encoding === 'proto') {
                        const payload = ProtoFetchMoreResponse.decode(protoPayloadBuffer!);
                        parsedPayload = {
                            paginatedData: decodeCursorPaginatedResponse(
                                payload.paginatedData!,
                                ProtoBacktestMintFullResult.decode,
                            )!,
                            appliedFilters: unpackFilters(payload.appliedFilters),
                        };
                    } else {
                        parsedPayload = (jsonData as unknown as DataFetchMoreResponse<BacktestMintFullResult>).payload;
                    }

                    logger.debug(
                        '[%s][%s] parsedPayload.paginatedData?.nextCursor %s',
                        header.channel,
                        header.id,
                        parsedPayload.paginatedData?.nextCursor,
                    );

                    assertIdUniqueness(parsedPayload.paginatedData!.data, 'id', receivedBacktestMintResultIds);

                    checkAndFetchMoreBacktestMintResultsData(parsedPayload.paginatedData!.nextCursor);
                } else if (header.event === 'update') {
                    let parsedUpdates: DataUpdateResponse<ProtoBacktestMintFullResult>['updates'];

                    if (encoding === 'proto') {
                        const payload = ProtoUpdatesPayload.decode(protoPayloadBuffer!);
                        parsedUpdates = unpackUpdatesPayload(payload, anyMsg => unpackAny(anyMsg));
                    } else {
                        parsedUpdates = (jsonData as unknown as DataUpdateResponse<ProtoBacktestMintFullResult>)
                            .updates;
                    }

                    logger.debug('[%s][%s] parsedUpdates %o', header.channel, header.id, parsedUpdates);
                }
            }
        } catch (err) {
            logger.error('❌ Failed to parse hybrid message: %o', err);
        }
    });

    ws.on('close', () => {
        logger.debug('Connection closed');
    });

    ws.on('error', err => {
        logger.error('WebSocket error:', err);
    });

    /**
     * A helper function to test the integrity of the response data
     *  check if the same mintResultId is returned twice
     */
    function assertIdUniqueness<T>(data: T[], idKey: keyof T, set: Set<string | number>): void {
        for (const el of data) {
            const elId = el[idKey] as string | number;
            if (set.has(elId)) {
                throw new Error(`Id ${elId} exists already`);
            }
            set.add(elId);
        }
    }

    function checkAndFetchMoreBacktestMintResultsData(nextCursor: string | null | undefined): void {
        if (nextCursor) {
            const message: FetchMoreMessage = {
                id: backtestsMintResultsSubscriptionId,
                channel: BACKTESTS_MINT_RESULTS_CHANNEL,
                event: 'fetchMore',
                data: {
                    limit: fetchLimit,
                    cursor: nextCursor,
                },
            };
            ws.send(JSON.stringify(message));
            logger.debug('[%s][%s] Sent fetchMore message: %o', message.channel, message.id, message);
        } else {
            logger.info('Fetched all data, total items %d', receivedBacktestMintResultIds.size);
        }
    }
}

main().catch(logger.error);
