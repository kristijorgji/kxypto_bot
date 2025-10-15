import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { ProtoUpdatesPayload } from '@src/protos/generated/ws';
import { packFilters, unpackFilters } from '@src/protos/mappers/filters';
import { packUpdateItem, unpackUpdateItem } from '@src/protos/mappers/updateItem';
import { UpdatesPayload } from '@src/ws-api/types';

export function packUpdatesPayload<T>(
    payload: UpdatesPayload<T>,
    encodeData: (data: T) => ProtoAny,
): ProtoUpdatesPayload {
    return {
        items: payload.items.map(i => packUpdateItem(i, encodeData)),
        appliedFilters: payload.appliedFilters ? packFilters(payload.appliedFilters) : {},
    };
}

export function unpackUpdatesPayload<T>(
    proto: ProtoUpdatesPayload,
    decodeData: (anyMsg: ProtoAny) => T,
): UpdatesPayload<T> {
    return {
        items: proto.items.map(i => unpackUpdateItem(i, decodeData)),
        appliedFilters: proto.appliedFilters ? unpackFilters(proto.appliedFilters) : {},
    };
}
