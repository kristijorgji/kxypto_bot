import { MessageFns, ProtoFetchMorePayload } from '@src/protos/generated/ws';
import {
    decodeCursorPaginatedResponse,
    packCursorPaginatedResponse,
} from '@src/protos/mappers/cursorPaginatedResponse';
import { packFilters, unpackFilters } from '@src/protos/mappers/filters';
import { FetchMorePayload } from '@src/ws-api/types';

export function packFetchMorePayload<T>(
    payload: FetchMorePayload<T>,
    encodeData: MessageFns<T>,
): ProtoFetchMorePayload {
    return {
        paginatedData: packCursorPaginatedResponse(payload.paginatedData, encodeData),
        appliedFilters: payload.appliedFilters ? packFilters(payload.appliedFilters) : {},
    };
}

export function unpackFetchMorePayload<T>(
    proto: ProtoFetchMorePayload,
    decodeData: MessageFns<T>['decode'],
): FetchMorePayload<T> {
    return {
        paginatedData: decodeCursorPaginatedResponse(proto.paginatedData!, decodeData)!,
        appliedFilters: proto.appliedFilters ? unpackFilters(proto.appliedFilters) : {},
    };
}
