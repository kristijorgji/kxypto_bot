import http, { IncomingMessage } from 'http';

import { WebSocketServer } from 'ws';

import { logger } from '@src/logger';

import { verifyWsJwt } from './middlewares/verifyWsJwt';
import { closeSubscription, handleMessage } from './router';
import { SubscriptionContext, WsConnection, WsUserPayload } from './types';

export const WS_CLOSE_CODES = {
    NORMAL: 1000,
    INVALID_JWT: 4001,
    INTERNAL_ERROR: 4500,
} as const;

const server = http.createServer();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (wsRaw, req) => {
    const ws = wsRaw as WsConnection;
    const url = new URL(req.url || '', `https://${req.headers.host}`);
    ws.debugMode = url.searchParams.get('debug') === 'json';

    const auth = extractWebSocketAuthToken(req);
    if (!auth) {
        ws.close(WS_CLOSE_CODES.INVALID_JWT, 'Unauthorized');
        return;
    }

    try {
        const userPayload: WsUserPayload = verifyWsJwt(auth.token);
        ws.user = userPayload;
        logger.debug('Client authorized %o', userPayload);
    } catch (err) {
        logger.error(err);
        ws.close(WS_CLOSE_CODES.INVALID_JWT, (err as Error).message);
        return;
    }

    ws.subscriptions = new Map<string, SubscriptionContext>();

    ws.on('message', data => handleMessage(logger, ws, data));

    ws.on('close', async () => {
        for (const sub of ws.subscriptions.values()) {
            await closeSubscription(sub);
        }
        ws.subscriptions.clear();
        logger.debug('Client disconnected');
    });
});

export { server, wss };

/**
 * Extract authentication token for this WebSocket connection.
 *
 * Browsers CANNOT send custom headers (like Authorization) during the WebSocket
 * handshake, so authenticated browser clients must send their JWT inside the
 * `Sec-WebSocket-Protocol` header:
 *
 *   new WebSocket(url, ["auth", `token.<JWT>`])
 *
 * The browser will send:
 *   Sec-WebSocket-Protocol: auth, token.<JWT>
 *
 * Server-side or non-browser WS clients may still send:
 *   Authorization: Bearer <JWT>
 *
 * Token resolution priority:
 *   1. From Sec-WebSocket-Protocol (browser WebSocket clients)
 *   2. From Authorization: Bearer <JWT> (server → server or Node clients)
 */
function extractWebSocketAuthToken(req: IncomingMessage): {
    token: string;
    source: 'Sec-WebSocket-Protocol' | 'Authorization';
} | null {
    // ✅ Attempt #1: Browser subprotocol
    const protoHeader = req.headers['sec-websocket-protocol'];
    if (protoHeader) {
        const parts = protoHeader.split(',').map(s => s.trim());
        const tokenPart = parts.find(p => p.startsWith('token.'));
        if (tokenPart) {
            const token = tokenPart.slice('token.'.length).trim();
            if (token) {
                return {
                    source: 'Sec-WebSocket-Protocol',
                    token,
                };
            }
        }
    }

    // ✅ Attempt #2: Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length).trim();
        if (token) {
            return {
                source: 'Authorization',
                token,
            };
        }
    }

    return null;
}
