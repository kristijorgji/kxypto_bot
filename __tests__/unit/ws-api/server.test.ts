// ignore __tests__/__mocks__/ws.ts for this test, use real implementation
jest.unmock('ws');
import http from 'http';
import { randomInt } from 'node:crypto';

import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';

import {
    BacktestStrategyFullResult,
    fetchBacktestsStrategyResultsCursorPaginated,
} from '../../../src/db/repositories/backtests';
import { CursorPaginatedResponse } from '../../../src/http-api/types';
import { ProtoBacktestStrategyFullResult } from '../../../src/protos/generated/backtests';
import { ProtoBacktestStrategyFullResultFactory } from '../../../src/testdata/factories/proto/backtests';
import { make } from '../../../src/testdata/utils';
import { WS_CLOSE_CODES, configureWsApp } from '../../../src/ws-api/configureWsApp';
import { BACKTESTS_STRATEGY_RESULTS_CHANNEL } from '../../../src/ws-api/handlers/backtests/strategyResultsHandler';
import { DataSubscriptionResponse, SubscribeMessage, WsUserPayload } from '../../../src/ws-api/types';

jest.mock('../../../src/ws-api/middlewares/verifyWsJwt');
const { verifyWsJwt } = require('../../../src/ws-api/middlewares/verifyWsJwt');

jest.mock('../../../src/db/repositories/backtests', () => ({
    ...jest.requireActual('../../../src/db/repositories/backtests'),
    fetchBacktestsStrategyResultsCursorPaginated: jest.fn().mockImplementation(async () => {
        const data = make(randomInt(1, 4), ProtoBacktestStrategyFullResultFactory);
        return {
            data: data,
            count: data.length,
            nextCursor: null,
        } satisfies CursorPaginatedResponse<ProtoBacktestStrategyFullResult>;
    }),
}));

const mockFetchBacktestsStrategyResultsCursorPaginated = fetchBacktestsStrategyResultsCursorPaginated as jest.Mocked<
    typeof fetchBacktestsStrategyResultsCursorPaginated
>;

describe('ws-api', () => {
    const TEST_PORT = parseInt(process.env.APP_WS_PORT as string);
    const WS_URL = `ws://localhost:${TEST_PORT}/ws?debug=json`;

    let server: http.Server;
    let wss: WebSocketServer;

    beforeAll(async () => {
        ({ server, wss } = await configureWsApp([]));
        await new Promise<void>(resolve => server.listen(TEST_PORT, resolve));
    });

    afterAll(async () => {
        // 1. Ensure all WebSocket clients are terminated.
        // Array.from is fine, but ensure you iterate over Ws connections.
        for (const client of Array.from(wss.clients.values())) {
            // Use terminate() for immediate cleanup of hanging connections
            client.terminate();
        }

        // 2. Wrap server.close() in a promise to ensure we wait for it.
        // It's possible server.close() is not waiting for all resources.
        // A common pattern is to explicitly unref or destroy the HTTP server socket.
        await new Promise<void>((resolve, reject) => {
            server.close(err => {
                if (err) {
                    // Check if the error is just 'Not running' or if it's serious
                    if (err.message !== 'Not running') {
                        // Log or handle unexpected errors during close
                        console.error('Error closing HTTP server:', err);
                        return reject(err);
                    }
                }
                resolve();
            });
        });
    });

    afterEach(() => {
        verifyWsJwt.mockClear();
    });

    describe('authentication', () => {
        it('should fail to connect without an Authorization header (code 4001) or Sec-WebSocket-Protocol token', async () => {
            expect.assertions(3);

            // Client connects with no headers
            const client = new WebSocket(WS_URL);

            const closePromise = new Promise<void>(resolve => {
                // The server closes the socket immediately upon connection
                client.on('close', (code, reason) => {
                    expect(code).toBe(WS_CLOSE_CODES.INVALID_JWT);
                    expect(reason.toString()).toBe('Unauthorized');
                    resolve();
                });
            });

            await closePromise;
            expect(verifyWsJwt).not.toHaveBeenCalled();
        });

        describe('using Authorization header', () => {
            it('should fail to connect with an invalid JWT (code 4001)', async () => {
                // Configure the mock to throw a specific error
                const errorMessage = 'JWT expired';
                verifyWsJwt.mockImplementation(() => {
                    throw new Error(errorMessage);
                });

                const headers = { Authorization: 'Bearer EXPIRED_TOKEN' };
                const client = new WebSocket(WS_URL, { headers });

                const closePromise = new Promise<void>(resolve => {
                    client.on('close', (code, reason) => {
                        expect(code).toBe(WS_CLOSE_CODES.INVALID_JWT);
                        expect(reason.toString()).toBe(errorMessage);
                        resolve();
                    });
                });

                await closePromise;
                expect(verifyWsJwt).toHaveBeenCalledWith('EXPIRED_TOKEN');
            });

            it('should successfully connect with a valid JWT', async () => {
                expect.assertions(2);
                await connectWithValidAuth();
            });
        });

        describe('using Sec-WebSocket-Protocol', () => {
            const formLifecyclePromise = (client: WebSocket) =>
                new Promise<void>((resolve, reject) => {
                    client.on('error', err => {
                        reject(new Error(`WebSocket error during connection: ${err.message}`));
                    });

                    client.on('open', () => {
                        try {
                            expect(client.readyState).toBe(WebSocket.OPEN);
                            client.close(WS_CLOSE_CODES.NORMAL);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });

                    client.on('close', (code, reason) => {
                        if (code === WS_CLOSE_CODES.NORMAL) {
                            resolve();
                        } else if (code === WS_CLOSE_CODES.INVALID_JWT) {
                            reject(new Error(`Server rejected connection: ${reason.toString()}`));
                        } else {
                            reject(new Error(`Unexpected close: Code ${code}, Reason: ${reason.toString()}`));
                        }
                    });
                });

            it('should successfully authenticate using Sec-WebSocket-Protocol token', async () => {
                expect.assertions(2);

                // mock verifyWsJwt to accept the token
                verifyWsJwt.mockImplementation(() => ({ userId: 'user-2' }) satisfies WsUserPayload);

                // browser-style subprotocol authentication
                const client = new WebSocket(WS_URL, ['auth', 'token.VALID_TOKEN_PROTO']);
                const lifecyclePromise = formLifecyclePromise(client);

                await lifecyclePromise;

                expect(verifyWsJwt).toHaveBeenCalledWith('VALID_TOKEN_PROTO');
            });

            it('should reject malformed Sec-WebSocket-Protocol tokens', async () => {
                expect.assertions(3);

                // malformed: missing "token." prefix
                const client = new WebSocket(WS_URL, ['auth', 'INVALIDPREFIX_ABC123']);

                const closePromise = new Promise<void>(resolve => {
                    client.on('close', (code, reason) => {
                        expect(code).toBe(WS_CLOSE_CODES.INVALID_JWT);
                        expect(reason.toString()).toBe('Unauthorized');
                        resolve();
                    });
                });

                await closePromise;
                expect(verifyWsJwt).not.toHaveBeenCalled();
            });

            it('should correctly authenticate when multiple subprotocols are provided (token in the middle)', async () => {
                expect.assertions(2);

                verifyWsJwt.mockImplementation(() => ({ userId: 'multi-1' }) satisfies WsUserPayload);

                // token subprotocol mixed between others
                const client = new WebSocket(WS_URL, ['chat', 'token.MULTI_TOKEN_ABC', 'json']);
                const lifecyclePromise = formLifecyclePromise(client);

                await lifecyclePromise;

                expect(verifyWsJwt).toHaveBeenCalledWith('MULTI_TOKEN_ABC');
            });
        });
    });

    it('should fail when using invalid payload', async () => {
        expect.assertions(3);
        await connectWithValidAuth({
            onOpen: ws => {
                return new Promise<void>((resolve, reject) => {
                    ws.once('message', (data: Buffer) => {
                        const jsonData = JSON.parse(data.toString());

                        try {
                            expect(jsonData).toEqual({
                                event: 'error',
                                error: 'Invalid message format',
                                message: 'The incoming WebSocket message does not match the expected schema.',
                                issues: [
                                    {
                                        code: 'invalid_union',
                                        message: 'Invalid input',
                                        path: '',
                                    },
                                ],
                            });
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });

                    ws.send(
                        JSON.stringify({
                            data: 'sigmaBalls',
                        }),
                        err => {
                            err && reject(err);
                        },
                    );
                });
            },
        });
    });

    it('should connect, subscribe to backtestMintsResults and receive snapshot with a valid JWT and json encoding', async () => {
        expect.assertions(4);
        const backtestsMintResultsSubscriptionId = `bsr_${uuidv4()}`;

        await connectWithValidAuth({
            onOpen: ws => {
                const subscriptionMessage: SubscribeMessage = {
                    id: backtestsMintResultsSubscriptionId,
                    event: 'subscribe',
                    channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
                    data: {
                        filters: {
                            chain: 'solana',
                            backtestName: '1000_sol_1_buy_randomized_ast_13640f',
                            strategyId: 'BuyPredictionStrategy_a8d5211f',
                            tradesOnly: true,
                            tradeOutcome: 'win',
                        },
                        pagination: {
                            limit: 50,
                        },
                    },
                };

                return new Promise<void>((resolve, reject) => {
                    ws.once('message', (data: Buffer) => {
                        const jsonData = JSON.parse(data.toString()) as DataSubscriptionResponse<
                            CursorPaginatedResponse<BacktestStrategyFullResult>
                        >;
                        try {
                            expect(jsonData).toEqual({
                                id: backtestsMintResultsSubscriptionId,
                                channel: BACKTESTS_STRATEGY_RESULTS_CHANNEL,
                                event: 'snapshot',
                                snapshot: expect.objectContaining({
                                    data: expect.objectContaining({
                                        count: jsonData.snapshot.data.data.length,
                                        data: expect.arrayContaining([
                                            expect.objectContaining({
                                                backtest_id: expect.any(String),
                                                backtest_run_id: expect.any(Number),
                                                status: expect.any(String),
                                                strategy: expect.any(String),
                                            }),
                                        ]),
                                        nextCursor: null,
                                    }),
                                    appliedFilters: subscriptionMessage.data.filters,
                                }),
                            });
                            expect(mockFetchBacktestsStrategyResultsCursorPaginated).toHaveBeenCalledTimes(1);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });

                    ws.send(JSON.stringify(subscriptionMessage), err => {
                        err && reject(err);
                    });
                });
            },
        });
    });

    async function connectWithValidAuth(p?: { onOpen?: (ws: WebSocket) => Promise<void> }) {
        verifyWsJwt.mockImplementation(() => ({ userId: 'user-1' }) satisfies WsUserPayload);

        const headers = { Authorization: 'Bearer VALID_TOKEN' };
        const client = new WebSocket(WS_URL, { headers });

        const lifecyclePromise = new Promise<void>((resolve, reject) => {
            client.on('error', err => {
                reject(new Error(`WebSocket error during connection: ${err.message}`));
            });

            client.on('open', async () => {
                expect(client.readyState).toBe(WebSocket.OPEN);
                if (p?.onOpen) {
                    try {
                        await p.onOpen(client);
                    } catch (error) {
                        reject(error);
                    }
                }

                client.close(WS_CLOSE_CODES.NORMAL); // Clean close
                resolve();
            });

            client.on('close', (code, reason) => {
                if (code === WS_CLOSE_CODES.NORMAL) {
                    resolve();
                } else if (code === WS_CLOSE_CODES.INVALID_JWT) {
                    reject(new Error(`Server rejected connection: ${reason.toString()}`));
                } else {
                    reject(new Error(`Unexpected or unclean close: Code ${code}, Reason: ${reason.toString()}`));
                }
            });
        });

        await lifecyclePromise;

        expect(verifyWsJwt).toHaveBeenCalledWith('VALID_TOKEN');
    }
});
