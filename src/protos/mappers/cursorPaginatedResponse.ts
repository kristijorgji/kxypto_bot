import { CursorPaginatedResponse } from '@src/http-api/types';
import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { MessageFns, ProtoCursorPaginatedResponse } from '@src/protos/generated/ws';
import { packAny, unpackAny } from '@src/protos/mappers/any';
import { DEFAULT_ANY_REGISTRY } from '@src/protos/utils/anyRegistry';
import { AnyRegistryManager } from '@src/protos/utils/AnyRegistryManager';

/**
 * Packs a paginated array of items into a CursorPaginatedResponse with ProtoAny.
 */
export function packCursorPaginatedResponse<T>(
    paginatedData: CursorPaginatedResponse<T>,
    encodeFn: MessageFns<T>,
    typeUrl?: string,
    registry?: AnyRegistryManager,
): ProtoCursorPaginatedResponse {
    const anyItems: ProtoAny[] = paginatedData.data.map(item =>
        packAny(item, encodeFn, typeUrl, registry ?? DEFAULT_ANY_REGISTRY),
    );

    return {
        data: anyItems,
        count: paginatedData.count,
        nextCursor: paginatedData.nextCursor ?? undefined,
    };
}

/**
 * Helper to decode Any-based CursorPaginatedResponse
 */
export function decodeCursorPaginatedResponse<T>(
    payload: ProtoCursorPaginatedResponse,
    decodeFn?: MessageFns<T>['decode'],
    registry?: AnyRegistryManager,
): CursorPaginatedResponse<T> | null {
    if (!payload?.data) {
        return null;
    }

    return {
        count: payload.count,
        nextCursor: payload.nextCursor,
        data: payload.data.map(any => unpackAny(any, decodeFn, registry ?? DEFAULT_ANY_REGISTRY)),
    } satisfies CursorPaginatedResponse<T>;
}
