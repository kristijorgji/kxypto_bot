import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { ProtoUpdateItem, ProtoUpdateItem_Action } from '@src/protos/generated/ws';
import { UpdateItem } from '@src/ws-api/types';

export function packUpdateItem<T>(item: UpdateItem<T>, encodeData: (data: T) => ProtoAny): ProtoUpdateItem {
    const actionMap: Record<UpdateItem['action'], ProtoUpdateItem_Action> = {
        added: ProtoUpdateItem_Action.ADDED,
        updated: ProtoUpdateItem_Action.UPDATED,
        deleted: ProtoUpdateItem_Action.DELETED,
    };

    const proto: ProtoUpdateItem = {
        id: item.id,
        action: actionMap[item.action],
        data: undefined,
    };

    if (item.action === 'added' || item.action === 'updated') {
        proto.data = encodeData(item.data);
    }

    if (item.action === 'updated') {
        proto.version = item.version;
    }

    return proto;
}

const actionMap: Record<ProtoUpdateItem_Action, UpdateItem['action']> = {
    [ProtoUpdateItem_Action.ADDED]: 'added',
    [ProtoUpdateItem_Action.UPDATED]: 'updated',
    [ProtoUpdateItem_Action.DELETED]: 'deleted',
    [ProtoUpdateItem_Action.UNRECOGNIZED]: 'updated',
};

export function unpackUpdateItem<T>(proto: ProtoUpdateItem, decodeData: (anyMsg: ProtoAny) => T): UpdateItem<T> {
    const action = actionMap[proto.action];

    switch (action) {
        case 'added':
            return {
                id: proto.id,
                action,
                data: decodeData(proto.data!),
            };
        case 'updated':
            return {
                id: proto.id,
                action,
                data: decodeData(proto.data!),
                version: proto.version!,
            };
        case 'deleted':
            return { id: proto.id, action };
    }
}
