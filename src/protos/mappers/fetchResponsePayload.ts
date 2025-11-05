import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { MessageFns, ProtoFetchResponsePayload } from '@src/protos/generated/ws';
import { unpackAny } from '@src/protos/mappers/any';
import { FetchResponsePayload } from '@src/ws-api/types';

export function packFetchResponsePayload<T>(
    payload: FetchResponsePayload<T>,
    encodeData: (data: T) => ProtoAny,
): ProtoFetchResponsePayload {
    return {
        requestId: payload.requestId,
        status: payload.status,
        data: !payload.data ? undefined : encodeData(payload.data),
    };
}

export function unpackFetchResponsePayload<T>(
    proto: ProtoFetchResponsePayload,
    decodeData: MessageFns<T>['decode'],
): FetchResponsePayload<T> {
    return {
        requestId: proto.requestId,
        status: proto.status,
        data: !proto.data ? null : unpackAny(proto.data, decodeData),
    };
}
