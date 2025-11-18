import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { MessageFns, ProtoRpcPayload, ProtoRpcStatus } from '@src/protos/generated/ws';
import { packAny } from '@src/protos/mappers/any';
import { RpcPayload } from '@src/ws-api/types';

export function packRpcPayload<TData, TError>(
    payload: RpcPayload<TData, TError>,
    encodeFn: MessageFns<TData | TError>,
): ProtoRpcPayload {
    if (payload.status === 'ok') {
        return {
            status: ProtoRpcStatus.OK,
            method: payload.method,
            success: {
                data: packAny(payload.data, encodeFn),
            },
        };
    }

    return {
        status: ProtoRpcStatus.ERROR,
        method: payload.method,
        error: {
            errorCode: payload.errorCode,
            errorMessage: payload.errorMessage,
            details: payload.details ? packAny(payload.details, encodeFn) : undefined,
        },
    };
}

export function unpackRpcPayload<TData, TError>(
    proto: ProtoRpcPayload,
    decodeSuccessData: (anyMsg: ProtoAny) => TData,
): RpcPayload<TData, TError> {
    if (proto.status === ProtoRpcStatus.OK) {
        return {
            status: 'ok',
            method: proto.method,
            data: decodeSuccessData(proto.success!.data!),
        };
    }

    return {
        status: 'error',
        method: proto.method,
        errorCode: proto.error!.errorCode,
        errorMessage: proto.error!.errorMessage,
        details: proto.error?.details as TError,
    };
}
