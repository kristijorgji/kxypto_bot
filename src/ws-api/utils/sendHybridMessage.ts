import { formHybridMessage } from '@src/protos/utils/hybridMessage';
import { BaseResponse, WsConnection } from '@src/ws-api/types';

/**
 * Sends a hybrid JSON + Protobuf message over a WebSocket connection.
 */
export default function <T>(
    ws: WsConnection,
    header: BaseResponse | Omit<BaseResponse, 'id'>,
    payload: T,
    encodeFn: (msg: T) => Uint8Array,
) {
    const payloadBuffer = encodeFn(payload);
    const finalBuffer = formHybridMessage(header, payloadBuffer);
    ws.send(finalBuffer);
}
