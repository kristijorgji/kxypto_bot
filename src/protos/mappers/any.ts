import { ProtoAny } from '@src/protos/generated/google/protobuf/any';
import { MessageFns } from '@src/protos/generated/ws';
import { DEFAULT_ANY_REGISTRY } from '@src/protos/utils/anyRegistry';
import { AnyRegistryManager } from '@src/protos/utils/AnyRegistryManager';

/**
 * Pack data into ProtoAny, using registry or fallback to class.name
 */
export function packAny<T>(
    data: T,
    protoClass: MessageFns<T>,
    typeUrl?: string,
    registry: AnyRegistryManager = DEFAULT_ANY_REGISTRY,
): ProtoAny {
    const resolvedTypeUrl = typeUrl ?? registry.getTypeUrl(protoClass);
    if (!resolvedTypeUrl) {
        throw new Error('Cannot determine typeUrl. Pass typeUrl explicitly or register the protoClass.');
    }

    return {
        type_url: resolvedTypeUrl,
        value: protoClass.encode(data).finish(),
    };
}

/**
 * Unpack ProtoAny into typed object
 */
export function unpackAny<T>(
    anyMsg: ProtoAny,
    decodeFn?: MessageFns<T>['decode'],
    registry: AnyRegistryManager = DEFAULT_ANY_REGISTRY,
): T {
    const protoClass = registry.getClass(anyMsg.type_url);

    if (!protoClass && !decodeFn) {
        throw new Error(`Cannot decode Any: type_url "${anyMsg.type_url}" not in registry and no decodeFn provided`);
    }

    const decoder = decodeFn ?? protoClass!.decode;
    return decoder(anyMsg.value) as T;
}
