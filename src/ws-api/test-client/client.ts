import '@src/core/loadEnv';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

import { CursorPaginatedResponse } from '@src/http-api/types';
import { logger } from '@src/logger';
import { ProtoBacktestMintFullResult, ProtoBacktestStrategyFullResult } from '@src/protos/generated/backtests';
import {
    MessageFns,
    ProtoCursorPaginatedSnapshotPayload,
    ProtoFetchMorePayload,
    ProtoUpdatesPayload,
} from '@src/protos/generated/ws';
import { unpackAny } from '@src/protos/mappers/any';
import { unpackFetchMorePayload } from '@src/protos/mappers/fetchMorePayload';
import { unpackCursorPaginatedSnapshotPayload } from '@src/protos/mappers/snapshotPayload';
import { unpackUpdatesPayload } from '@src/protos/mappers/updatesPayload';
import { parseHybridMessage } from '@src/protos/utils/hybridMessage';
import { BACKTESTS_MINT_RESULTS_CHANNEL } from '@src/ws-api/handlers/backtests/mintResultsHandler';
import { BACKTESTS_STRATEGY_RESULTS_CHANNEL } from '@src/ws-api/handlers/backtests/strategyResultsHandler';
import {
    BaseResponse,
    DataFetchMoreResponse,
    DataSubscriptionResponse,
    DataUpdateResponse,
    FetchMoreMessage,
    ResponseEventType,
    SubscribeMessage,
} from '@src/ws-api/types';

type SupportedEncoding = 'proto' | 'json';

const encoding: SupportedEncoding = 'proto';

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

    const fetchLimit = 50;
    const receivedBacktestStrategyResultIds: Set<string> = new Set();
    const receivedBacktestMintResultIds: Set<string> = new Set();

    ws.on('open', () => {
        logger.debug(`✅ Connected to WS ${ws.url} using ${encoding} encoding`);

        const backtestStrategyResultsSubscriptionMessage: SubscribeMessage = {
            id: `bsr_${uuidv4()}`,
            event: 'subscribe',
            channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
            data: {
                filters: {
                    chain: 'solana',
                },
                pagination: {
                    limit: fetchLimit,
                },
            },
        };
        ws.send(JSON.stringify(backtestStrategyResultsSubscriptionMessage));
        logger.debug(
            '📨 Sent backtestStrategyResultsSubscription message: %o',
            backtestStrategyResultsSubscriptionMessage,
        );

        const backtestMintResultsSubscriptionMessage: SubscribeMessage = {
            id: `bsmr_${uuidv4()}`,
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
        ws.send(JSON.stringify(backtestMintResultsSubscriptionMessage));
        logger.debug('📨 Sent backtestMintResultsSubscription message: %o', backtestMintResultsSubscriptionMessage);
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

            if (header.channel === BACKTESTS_STRATEGY_RESULTS_CHANNEL) {
                handleChannelEvents(header, protoPayloadBuffer, jsonData, ProtoBacktestStrategyFullResult, {
                    idProperty: 'id',
                    idsSet: receivedBacktestStrategyResultIds,
                });
            } else if (header.channel === BACKTESTS_MINT_RESULTS_CHANNEL) {
                handleChannelEvents(header, protoPayloadBuffer, jsonData, ProtoBacktestMintFullResult, {
                    idProperty: 'id',
                    idsSet: receivedBacktestMintResultIds,
                });
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

    function handleChannelEvents<T>(
        header: BaseResponse,
        protoPayloadBuffer: Buffer | undefined,
        jsonData: Record<string, unknown> | undefined,
        protoClass: MessageFns<T>,
        assertUniquenessConfig: {
            idProperty: keyof T;
            idsSet: Set<string | number>;
        },
    ) {
        if (header.event === 'snapshot') {
            const parsedSnapshot: DataSubscriptionResponse<CursorPaginatedResponse<T>>['snapshot'] = decodePayload(
                encoding,
                protoPayloadBuffer,
                jsonData,
                input =>
                    unpackCursorPaginatedSnapshotPayload(
                        ProtoCursorPaginatedSnapshotPayload.decode(input!),
                        protoClass.decode,
                    ),
            );
            logger.debug('[%s][%s] parsedSnapshot %o', header.channel, header.id, parsedSnapshot);
            assertIdUniqueness(
                parsedSnapshot.data.data,
                assertUniquenessConfig.idProperty,
                assertUniquenessConfig.idsSet,
            );
            checkAndFetchMore(header.id, header.channel, assertUniquenessConfig.idsSet, parsedSnapshot.data.nextCursor);
        } else if (header.event === 'fetchMore') {
            const parsedPayload: DataFetchMoreResponse<T>['payload'] = decodePayload(
                encoding,
                protoPayloadBuffer,
                jsonData,
                input => unpackFetchMorePayload(ProtoFetchMorePayload.decode(input), protoClass.decode),
            );
            logger.debug(
                '[%s][%s] parsedPayload.paginatedData?.nextCursor %s',
                header.channel,
                header.id,
                parsedPayload.paginatedData?.nextCursor,
            );
            assertIdUniqueness(
                parsedPayload.paginatedData!.data,
                assertUniquenessConfig.idProperty,
                assertUniquenessConfig.idsSet,
            );
            checkAndFetchMore(
                header.id,
                header.channel,
                assertUniquenessConfig.idsSet,
                parsedPayload.paginatedData!.nextCursor,
            );
        } else if (header.event === 'update') {
            const parsedUpdates: DataUpdateResponse<T>['updates'] = decodePayload(
                encoding,
                protoPayloadBuffer,
                jsonData,
                input => unpackUpdatesPayload(ProtoUpdatesPayload.decode(input), anyMsg => unpackAny(anyMsg)),
            );
            logger.debug('[%s][%s] parsedUpdates %o', header.channel, header.id, parsedUpdates);
        }
    }

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

    function checkAndFetchMore(
        subscriptionId: string,
        channel: string,
        idsSet: Set<string | number>,
        nextCursor: string | null | undefined,
    ): void {
        if (nextCursor) {
            const message: FetchMoreMessage = {
                id: subscriptionId,
                channel: channel,
                event: 'fetchMore',
                data: {
                    limit: fetchLimit,
                    cursor: nextCursor,
                },
            };
            ws.send(JSON.stringify(message));
            logger.debug('[%s][%s] Sent fetchMore message: %o', channel, subscriptionId, message);
        } else {
            logger.info('[%s][%s] Fetched all data, total items %d', channel, subscriptionId, idsSet.size);
        }
    }
}

main().catch(logger.error);

function decodePayload<T>(
    encoding: SupportedEncoding,
    protoPayloadBuffer: Buffer | undefined,
    jsonData: Record<string, unknown> | undefined,
    decodeFn: MessageFns<T>['decode'],
) {
    if (encoding === 'proto') {
        return decodeFn(protoPayloadBuffer!);
    } else if (encoding === 'json') {
        return jsonData as unknown as T;
    }

    throw new Error(`Unsupported encoding ${encoding}`);
}
