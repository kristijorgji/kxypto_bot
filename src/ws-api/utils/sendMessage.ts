import { CursorPaginatedResponse } from '@src/http-api/types';
import {
    MessageFns,
    ProtoCursorPaginatedSnapshotPayload,
    ProtoFetchMorePayload,
    ProtoFetchResponsePayload,
    ProtoUpdatesPayload,
} from '@src/protos/generated/ws';
import { packAny } from '@src/protos/mappers/any';
import { packFetchMorePayload } from '@src/protos/mappers/fetchMorePayload';
import { packFetchResponsePayload } from '@src/protos/mappers/fetchResponsePayload';
import { packCursorPaginatedSnapshotPayload } from '@src/protos/mappers/snapshotPayload';
import { packUpdatesPayload } from '@src/protos/mappers/updatesPayload';
import {
    BaseResponse,
    DataFetchMoreResponse,
    DataSubscriptionResponse,
    DataUpdateResponse,
    FetchMorePayload,
    FetchResponse,
    FetchResponsePayload,
    SnapshotPayload,
    UpdatesPayload,
    WsConnection,
} from '@src/ws-api/types';
import sendHybridMessage from '@src/ws-api/utils/sendHybridMessage';

export default function sendCursorPaginatedSnapshotResponse<T>(
    ws: WsConnection,
    header: BaseResponse<'snapshot'>,
    snapshotPayload: SnapshotPayload<CursorPaginatedResponse<T>>,
    encodeFn: MessageFns<T>,
): void {
    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                snapshot: snapshotPayload,
            } satisfies DataSubscriptionResponse<CursorPaginatedResponse<T>>),
        );
    } else {
        sendHybridMessage(ws, header, packCursorPaginatedSnapshotPayload(snapshotPayload, encodeFn), msg =>
            ProtoCursorPaginatedSnapshotPayload.encode(msg).finish(),
        );
    }
}

export function sendFetchMoreResponse<T>(
    ws: WsConnection,
    header: BaseResponse<'fetchMore'>,
    fetchMorePayload: FetchMorePayload<T>,
    encodeFn: MessageFns<T>,
): void {
    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                payload: fetchMorePayload,
            } satisfies DataFetchMoreResponse<T>),
        );
    } else {
        sendHybridMessage(ws, header, packFetchMorePayload(fetchMorePayload, encodeFn), msg =>
            ProtoFetchMorePayload.encode(msg).finish(),
        );
    }
}

export function sendFetchResponse<T>(
    ws: WsConnection,
    header: Omit<BaseResponse<'fetch_response'>, 'id'>,
    fetchPayload: FetchResponsePayload<T>,
    encodeFn: MessageFns<T>,
): void {
    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                payload: fetchPayload,
            } satisfies FetchResponse<T>),
        );
    } else {
        sendHybridMessage(
            ws,
            header,
            packFetchResponsePayload(fetchPayload, item => packAny(item, encodeFn)),
            msg => ProtoFetchResponsePayload.encode(msg).finish(),
        );
    }
}

export function sendUpdatesResponse<T>(
    ws: WsConnection,
    header: BaseResponse<'update'>,
    updatesPayload: UpdatesPayload<T>,
    encodeFn: MessageFns<T>,
): void {
    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                updates: updatesPayload,
            } satisfies DataUpdateResponse<T>),
        );
    } else {
        sendHybridMessage(
            ws,
            header,
            packUpdatesPayload(updatesPayload, item => packAny(item, encodeFn)),
            msg => ProtoUpdatesPayload.encode(msg).finish(),
        );
    }
}
