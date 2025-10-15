import http from 'http';

import { WebSocketServer } from 'ws';

import { logger } from '@src/logger';

import { verifyWsJwt } from './middlewares/verifyWsJwt';
import { handleMessage } from './router';
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
    ws.subscriptions = new Map<string, SubscriptionContext>();

    const url = new URL(req.url || '', `https://${req.headers.host}`);
    ws.debugMode = url.searchParams.get('debug') === 'json';

    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            ws.close(WS_CLOSE_CODES.INVALID_JWT, 'Unauthorized');
            return;
        }

        const token = authHeader.split(' ')[1];
        const userPayload: WsUserPayload = verifyWsJwt(token);
        ws.user = userPayload;

        logger.debug('Client authorized %o', userPayload);
    } catch (err) {
        logger.error(err);
        ws.close(WS_CLOSE_CODES.INVALID_JWT, (err as Error).message);
        return;
    }

    ws.on('message', data => handleMessage(logger, ws, data));

    ws.on('close', () => {
        for (const sub of ws.subscriptions.values()) {
            if (sub.interval) clearInterval(sub.interval);
        }
        ws.subscriptions.clear();
        logger.debug('Client disconnected');
    });
});

export { server, wss };
