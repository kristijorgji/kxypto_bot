// ignore __tests__/__mocks__/ws.ts for this test, use real implementation
jest.unmock('ws');
import { randomInt } from 'node:crypto';

import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';

import {
    BacktestMintFullResult,
    fetchBacktestsMintResultsCursorPaginated,
} from '../../../src/db/repositories/backtests';
import { CursorPaginatedResponse } from '../../../src/http-api/types';
import { ProtoBacktestMintFullResultFactory } from '../../../src/testdata/factories/proto/backtests';
import { make } from '../../../src/testdata/utils';
import { WS_CLOSE_CODES, server, wss } from '../../../src/ws-api/configureWsApp';
import { BACKTESTS_MINT_RESULTS_CHANNEL } from '../../../src/ws-api/handlers/backtestsHandler';
import { DataSubscriptionResponse, SubscribeMessage, WsUserPayload } from '../../../src/ws-api/types';

jest.mock('../../../src/ws-api/middlewares/verifyWsJwt');
const { verifyWsJwt } = require('../../../src/ws-api/middlewares/verifyWsJwt');

jest.mock('../../../src/db/repositories/backtests', () => ({
    ...jest.requireActual('../../../src/db/repositories/backtests'),
    fetchBacktestsMintResultsCursorPaginated: jest.fn().mockImplementation(async () => {
        const data = make(randomInt(1, 4), ProtoBacktestMintFullResultFactory);
        return {
            data: data,
            count: data.length,
            nextCursor: null,
        } satisfies CursorPaginatedResponse<BacktestMintFullResult>;
    }),
}));

const mockedHandleBacktestsMintResultsSubscription = fetchBacktestsMintResultsCursorPaginated as jest.Mocked<
    typeof fetchBacktestsMintResultsCursorPaginated
>;

describe('ws-api', () => {
    const TEST_PORT = parseInt(process.env.APP_WS_PORT as string);
    const WS_URL = `ws://localhost:${TEST_PORT}/ws?debug=json`;

    beforeAll(async () => {
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
        it('should fail to connect without an Authorization header (code 4001)', async () => {
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

    it('should connect, subscribe to backtestMintsResults and receive snapshot with a valid JWT and json encoding', async () => {
        expect.assertions(4);
        const backtestsMintResultsSubscriptionId = `bmr_${uuidv4()}`;

        await connectWithValidAuth({
            onOpen: ws => {
                const subscriptionMessage: SubscribeMessage = {
                    id: backtestsMintResultsSubscriptionId,
                    event: 'subscribe',
                    channel: BACKTESTS_MINT_RESULTS_CHANNEL,
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
                            CursorPaginatedResponse<BacktestMintFullResult>
                        >;
                        try {
                            expect(jsonData).toEqual({
                                id: backtestsMintResultsSubscriptionId,
                                channel: BACKTESTS_MINT_RESULTS_CHANNEL,
                                event: 'snapshot',
                                snapshot: expect.objectContaining({
                                    data: expect.objectContaining({
                                        count: jsonData.snapshot.data.data.length,
                                        data: expect.arrayContaining([
                                            expect.objectContaining({ backtest_id: expect.any(String) }),
                                        ]),
                                        nextCursor: null,
                                    }),
                                    appliedFilters: subscriptionMessage.data.filters,
                                }),
                            });
                            expect(mockedHandleBacktestsMintResultsSubscription).toHaveBeenCalledTimes(1);
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
