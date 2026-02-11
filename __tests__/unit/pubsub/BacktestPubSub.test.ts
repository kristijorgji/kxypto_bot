import redisMock from 'ioredis-mock';
import { createLogger } from 'winston';

import { ProtoBacktestRun } from '../../../src/protos/generated/backtests';
import BacktestPubSub from '../../../src/pubsub/BacktestPubSub';
import MemoryPubSub from '../../../src/pubsub/MemoryPubSub';
import PubSub from '../../../src/pubsub/PubSub';
import RedisPubSub from '../../../src/pubsub/RedisPubSub';
import { ProtoBacktestRunFactory } from '../../../src/testdata/factories/proto/backtests';
import { UpdateItem } from '../../../src/ws-api/types';

type PubSubFactory = () => PubSub;

const silentLogger = createLogger({
    silent: true,
    transports: [],
});

/**
 * Helper to promisify the receipt of multiple events.
 * This keeps 'expect' calls on the main test thread.
 */
const createSignal = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

function backtestPubSubTests(pubsubFactory: PubSubFactory, label: string) {
    describe(`BacktestPubSub Tests (${label})`, () => {
        let pubsub: PubSub;
        let backtestPubSub: BacktestPubSub;

        beforeEach(() => {
            pubsub = pubsubFactory();
            backtestPubSub = new BacktestPubSub(pubsub);
        });

        it('should receive single strategy mint', async () => {
            const { promise, resolve, reject } = createSignal();

            const handler = (data: { value: number }, channel: string) => {
                try {
                    expect(channel).toBe('backtest:bt1:strategy:st1:mint');
                    expect(data.value).toBe(42);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            await backtestPubSub.subscribeBacktestStrategyMint('bt1', 'st1', handler);
            await backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 42 });
            await promise;
        });

        it('should receive all backtestRuns and stop receiving on unsubscribe', async () => {
            const { promise, resolve, reject } = createSignal();
            const itemsToDispatch: UpdateItem<ProtoBacktestRun>[] = [
                {
                    id: '1',
                    action: 'added',
                    data: ProtoBacktestRunFactory({ id: 1 }),
                },
                {
                    id: '2',
                    action: 'added',
                    data: ProtoBacktestRunFactory({ id: 2 }),
                },
                {
                    id: '3',
                    action: 'added',
                    data: ProtoBacktestRunFactory({ id: 3 }),
                },
            ];

            const received: {
                channel: string;
                data: UpdateItem<ProtoBacktestRun>;
            }[] = [];

            const handler = (data: UpdateItem<ProtoBacktestRun>, channel: string) => {
                received.push({ data, channel });
                if (received.length === 2) {
                    try {
                        expect(received).toEqual([
                            { channel: 'backtestRun:1', data: itemsToDispatch[0] },
                            { channel: 'backtestRun:3', data: itemsToDispatch[2] },
                        ]);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            await backtestPubSub.subscribeAllRuns(handler);
            await backtestPubSub.publishBacktestRun(itemsToDispatch[0]);
            await backtestPubSub.unsubscribeAllRuns();

            await backtestPubSub.publishBacktestRun(itemsToDispatch[1]);
            await backtestPubSub.subscribeAllRuns(handler);
            await backtestPubSub.publishBacktestRun(itemsToDispatch[2]);

            await promise;
        });

        it('should receive all strategy mints for a backtest', async () => {
            const { promise, resolve, reject } = createSignal();
            const received: { data: { value: number }; channel: string }[] = [];

            const handler = (data: { value: number }, channel: string) => {
                received.push({ data, channel });
                if (received.length === 2) {
                    try {
                        expect(received).toEqual([
                            { channel: 'backtest:bt1:strategy:st1:mint', data: { value: 1 } },
                            { channel: 'backtest:bt1:strategy:st2:mint', data: { value: 2 } },
                        ]);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            await backtestPubSub.subscribeBacktestAllMints('bt1', handler);
            await backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 1 });
            await backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st2', { value: 2 });

            await promise;
        });

        it('should receive all strategy results across all backtests and stop receiving on unsubscribe', async () => {
            const { promise, resolve, reject } = createSignal();
            const received: { data: unknown; channel: string }[] = [];

            const handler = (data: unknown, channel: string) => {
                received.push({ data, channel });
                if (received.length === 4) {
                    try {
                        expect(received).toEqual([
                            { channel: 'backtest:bt1:strategy:st1:mint', data: { value: 10 } },
                            { channel: 'backtest:bt2:strategy:st2:mint', data: { value: 20 } },
                            { channel: 'backtest:bt1:strategy:st1:result', data: { config: 'strategyConfig-st1' } },
                            { channel: 'backtest:bt4:strategy:st4:result', data: { config: 'strategyConfig-st4' } },
                        ]);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            /**
             * Subscribe to both to ensure there is no pattern overlap
             */
            await backtestPubSub.subscribeAllStrategyResults(handler);
            await backtestPubSub.subscribeAllMintsResults(handler);

            await backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 10 });
            await backtestPubSub.publishBacktestStrategyMintResult('bt2', 'st2', { value: 20 });
            await backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { config: 'strategyConfig-st1' });

            await backtestPubSub.unsubscribeAllStrategyResults();

            await backtestPubSub.publishBacktestStrategyResult('bt3', 'st3', { config: 'strategyConfig-st3:miss' });
            await backtestPubSub.subscribeAllStrategyResults(handler);
            await backtestPubSub.publishBacktestStrategyResult('bt4', 'st4', { config: 'strategyConfig-st4' });

            await promise;
        });

        it('should receive all mints across all backtests and stop receiving on unsubscribe', async () => {
            const { promise, resolve, reject } = createSignal();
            const received: { data: { value: number }; channel: string }[] = [];

            const handler = (data: { value: number }, channel: string) => {
                received.push({ data, channel });
                if (received.length === 3) {
                    try {
                        expect(received).toEqual([
                            { channel: 'backtest:bt1:strategy:st1:mint', data: { value: 10 } },
                            { channel: 'backtest:bt2:strategy:st2:mint', data: { value: 20 } },
                            { channel: 'backtest:bt4:strategy:st4:mint', data: { value: 40 } },
                        ]);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            await backtestPubSub.subscribeAllMintsResults(handler);
            await backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 10 });
            await backtestPubSub.publishBacktestStrategyMintResult('bt2', 'st2', { value: 20 });

            await backtestPubSub.unsubscribeAllMintsResults();

            await backtestPubSub.publishBacktestStrategyMintResult('bt3', 'st3', { value: 30 });
            await backtestPubSub.subscribeAllMintsResults(handler);
            await backtestPubSub.publishBacktestStrategyMintResult('bt4', 'st4', { value: 40 });

            await promise;
        });

        it('should receive single strategy result', async () => {
            const { promise, resolve, reject } = createSignal();

            const handler = (data: { score: number }, channel: string) => {
                try {
                    expect(channel).toBe('backtest:bt1:strategy:st1:result');
                    expect(data.score).toBe(99);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            await backtestPubSub.subscribeBacktestStrategyResult('bt1', 'st1', handler);
            await backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 99 });

            await promise;
        });

        it('should receive all strategy results for a backtest', async () => {
            const { promise, resolve, reject } = createSignal();
            const received: number[] = [];

            const handler = (data: { score: number }) => {
                received.push(data.score);
                if (received.length === 2) {
                    try {
                        expect(received).toContain(7);
                        expect(received).toContain(8);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            await backtestPubSub.subscribeBacktestAllStrategyResults('bt1', handler);
            await backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 7 });
            await backtestPubSub.publishBacktestStrategyResult('bt1', 'st2', { score: 8 });

            await promise;
        });

        it('should receive all strategy results across all backtests', async () => {
            const { promise, resolve, reject } = createSignal();
            const received: number[] = [];

            const handler = (data: { score: number }) => {
                received.push(data.score);
                if (received.length === 2) {
                    try {
                        expect(received).toContain(100);
                        expect(received).toContain(200);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };

            await backtestPubSub.subscribeAllBacktestsStrategyResults(handler);
            await backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 100 });
            await backtestPubSub.publishBacktestStrategyResult('bt2', 'st2', { score: 200 });

            await promise;
        });
    });
}

// -----------------------------
// Run tests for MemoryPubSub
// -----------------------------
backtestPubSubTests(() => new MemoryPubSub(), 'MemoryPubSub');

// -----------------------------
// Run tests for RedisPubSub (mocked)
// -----------------------------
backtestPubSubTests(() => {
    const pub = new redisMock();
    const sub = new redisMock();
    return new RedisPubSub({ logger: silentLogger, pub, sub });
}, 'RedisPubSub (mock)');
