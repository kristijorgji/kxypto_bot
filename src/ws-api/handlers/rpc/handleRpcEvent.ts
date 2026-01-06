import { Logger } from 'winston';

import { ProtoStruct } from '@src/protos/generated/google/protobuf/struct';
import { MessageFns, ProtoRpcPayload } from '@src/protos/generated/ws';
import { MapperError } from '@src/protos/mappers/errors';
import { packRpcPayload } from '@src/protos/mappers/rpcPayload';
import PubSub from '@src/pubsub/PubSub';
import { rpcRegistry } from '@src/ws-api/handlers/rpc/registry';
import { BaseRpcResponse, RpcMessage, RpcPayload, RpcResponse, WsConnection } from '@src/ws-api/types';
import sendHybridMessage from '@src/ws-api/utils/sendHybridMessage';

export async function handleRpcEvent(
    logger: Logger,
    ws: WsConnection,
    msg: RpcMessage,
    deps: { pubsub: PubSub; pendingDistributedRpc: Record<string, (data: unknown) => void> },
): Promise<void> {
    logger.debug('Handling RPC method %s, id %s', msg.method, msg.id);

    const handler = rpcRegistry[msg.method];
    if (!handler) {
        ws.send(
            JSON.stringify({
                id: msg.id,
                event: 'rpc_response',
                error: `Unknown RPC method: ${msg.method}`,
            }),
        );
        return;
    }

    try {
        const validatedData = handler.schema.safeParse(msg.data);
        if (!validatedData.success) {
            ws.send(
                JSON.stringify({
                    id: msg.id,
                    event: 'rpc_response',
                    error: 'Invalid RPC payload',
                    issues: validatedData.error.errors.map(issue => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                }),
            );
            return;
        }

        const result = await handler.run(validatedData.data, {
            ws,
            logger,
            pubsub: deps.pubsub,
            pendingDistributedRpc: deps.pendingDistributedRpc,
        });

        sendRpcResponse(
            ws,
            {
                id: msg.id,
                event: 'rpc_response',
            },
            {
                status: 'ok',
                method: msg.method,
                data: result,
            },
            handler.successDataProtoClass,
        );

        logger.debug('Finished handling RPC method %s, id %s', msg.method, msg.id);
    } catch (err) {
        if (err instanceof MapperError) {
            throw err;
        }

        logger.error('RPC error:', err, msg.method, msg.id);

        sendRpcResponse(
            ws,
            {
                id: msg.id,
                event: 'rpc_response',
            },
            {
                status: 'error',
                method: msg.method,
                errorCode: '500',
                errorMessage: (err as Error).message ?? 'Unknown RPC server error',
            },
            ProtoStruct,
        );
    }
}

function sendRpcResponse<TData, TError>(
    ws: WsConnection,
    header: BaseRpcResponse,
    payload: RpcPayload<TData, TError>,
    encodeFn: MessageFns<TData | TError>,
) {
    if (ws.debugMode) {
        ws.send(
            JSON.stringify({
                ...header,
                payload: payload,
            } satisfies RpcResponse),
        );
    } else {
        sendHybridMessage(ws, header, packRpcPayload(payload, encodeFn), msg => {
            return ProtoRpcPayload.encode(msg).finish();
        });
    }
}
