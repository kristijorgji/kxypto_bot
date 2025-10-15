import { MessageFns } from '@src/protos/generated/ws';

/**
 * Bidirectional registry for Any types
 */
export class AnyRegistryManager {
    private typeUrlToClass = new Map<string, MessageFns<unknown>>();
    private classToTypeUrl = new Map<MessageFns<unknown>, string>();

    constructor(initial?: Record<string, MessageFns<unknown>>) {
        if (initial) {
            for (const [url, cls] of Object.entries(initial)) {
                this.register(url, cls);
            }
        }
    }

    register(typeUrl: string, protoClass: MessageFns<unknown>) {
        this.typeUrlToClass.set(typeUrl, protoClass);
        this.classToTypeUrl.set(protoClass, typeUrl);
    }

    getClass(typeUrl: string): MessageFns<unknown> | undefined {
        return this.typeUrlToClass.get(typeUrl);
    }

    getTypeUrl(protoClass: MessageFns<unknown>): string | undefined {
        return this.classToTypeUrl.get(protoClass);
    }
}
