import { CursorPaginatedResponse } from '@src/http-api/types';
import { MessageFns, ProtoCursorPaginatedSnapshotPayload } from '@src/protos/generated/ws';
import {
    decodeCursorPaginatedResponse,
    packCursorPaginatedResponse,
} from '@src/protos/mappers/cursorPaginatedResponse';
import { packFilters, unpackFilters } from '@src/protos/mappers/filters';
import { SnapshotPayload } from '@src/ws-api/types';

export function packCursorPaginatedSnapshotPayload<T>(
    payload: SnapshotPayload<CursorPaginatedResponse<T>>,
    encodeData: MessageFns<T>,
): ProtoCursorPaginatedSnapshotPayload {
    return {
        data: packCursorPaginatedResponse(payload.data, encodeData),
        appliedFilters: payload.appliedFilters ? packFilters(payload.appliedFilters) : {},
    };
}

export function unpackCursorPaginatedSnapshotPayload<T>(
    proto: ProtoCursorPaginatedSnapshotPayload,
    decodeData: MessageFns<T>['decode'],
): SnapshotPayload<CursorPaginatedResponse<T>> {
    return {
        data: decodeCursorPaginatedResponse(proto.data!, decodeData)!,
        appliedFilters: proto.appliedFilters ? unpackFilters(proto.appliedFilters) : {},
    };
}
