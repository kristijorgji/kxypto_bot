import redisMock from 'ioredis-mock';
import { createLogger } from 'winston';

import BacktestPubSub from '../../../src/pubsub/BacktestPubSub';
import MemoryPubSub from '../../../src/pubsub/MemoryPubSub';
import PubSub from '../../../src/pubsub/PubSub';
import RedisPubSub from '../../../src/pubsub/RedisPubSub';

type PubSubFactory = () => PubSub;

const silentLogger = createLogger({
    silent: true,
    transports: [],
});

function backtestPubSubTests(pubsubFactory: PubSubFactory, label: string) {
    describe(`BacktestPubSub Tests (${label})`, () => {
        let pubsub: PubSub;
        let backtestPubSub: BacktestPubSub;

        beforeEach(() => {
            pubsub = pubsubFactory();
            backtestPubSub = new BacktestPubSub(pubsub);
        });

        it('should receive single strategy mint', done => {
            const handler = (data: { value: number }, channel: string) => {
                expect(channel).toBe('backtest:bt1:strategy:st1:mint');
                expect(data.value).toBe(42);
                done();
            };

            backtestPubSub.subscribeBacktestStrategyMint('bt1', 'st1', handler);
            backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 42 });
        });

        it('should receive all strategy mints for a backtest', done => {
            const received: {
                data: {
                    value: number;
                };
                channel: string;
            }[] = [];
            const handler = (data: { value: number }, channel: string) => {
                received.push({
                    data: data,
                    channel: channel,
                });
                if (received.length === 2) {
                    expect(received).toEqual([
                        {
                            channel: 'backtest:bt1:strategy:st1:mint',
                            data: {
                                value: 1,
                            },
                        },
                        {
                            channel: 'backtest:bt1:strategy:st2:mint',
                            data: {
                                value: 2,
                            },
                        },
                    ]);
                    done();
                }
            };

            backtestPubSub.subscribeBacktestAllMints('bt1', handler);
            backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 1 });
            backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st2', { value: 2 });
        });

        it('should receive all strategy results across all backtests and stop receiving on unsubscribe', done => {
            const received: {
                data: unknown;
                channel: string;
            }[] = [];
            const handler = (data: unknown, channel: string) => {
                received.push({
                    data: data,
                    channel: channel,
                });
                if (received.length === 4) {
                    expect(received).toEqual([
                        {
                            channel: 'backtest:bt1:strategy:st1:mint',
                            data: {
                                value: 10,
                            },
                        },
                        {
                            channel: 'backtest:bt2:strategy:st2:mint',
                            data: {
                                value: 20,
                            },
                        },
                        {
                            channel: 'backtest:bt1:strategy:st1:result',
                            data: {
                                config: 'strategyConfig-st1',
                            },
                        },
                        {
                            channel: 'backtest:bt4:strategy:st4:result',
                            data: {
                                config: 'strategyConfig-st4',
                            },
                        },
                    ]);
                    done();
                }
            };

            /**
             * Subscribe to both to ensure there is no pattern overlap
             */
            backtestPubSub.subscribeAllStrategyResults(handler);
            backtestPubSub.subscribeAllMintsResults(handler);

            backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 10 });
            backtestPubSub.publishBacktestStrategyMintResult('bt2', 'st2', { value: 20 });

            backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { config: 'strategyConfig-st1' });
            backtestPubSub.unsubscribeAllStrategyResults().then(() => {
                backtestPubSub.publishBacktestStrategyResult('bt3', 'st3', { config: 'strategyConfig-st3:miss' });
                backtestPubSub.subscribeAllStrategyResults(handler);
                backtestPubSub.publishBacktestStrategyResult('bt4', 'st4', { config: 'strategyConfig-st4' });
            });
        });

        it('should receive all mints across all backtests and stop receiving on unsubscribe', done => {
            const received: {
                data: {
                    value: number;
                };
                channel: string;
            }[] = [];
            const handler = (data: { value: number }, channel: string) => {
                received.push({
                    data: data,
                    channel: channel,
                });
                if (received.length === 3) {
                    expect(received).toEqual([
                        {
                            channel: 'backtest:bt1:strategy:st1:mint',
                            data: {
                                value: 10,
                            },
                        },
                        {
                            channel: 'backtest:bt2:strategy:st2:mint',
                            data: {
                                value: 20,
                            },
                        },
                        {
                            channel: 'backtest:bt4:strategy:st4:mint',
                            data: {
                                value: 40,
                            },
                        },
                    ]);
                    done();
                }
            };

            backtestPubSub.subscribeAllMintsResults(handler);
            backtestPubSub.publishBacktestStrategyMintResult('bt1', 'st1', { value: 10 });
            backtestPubSub.publishBacktestStrategyMintResult('bt2', 'st2', { value: 20 });

            backtestPubSub.unsubscribeAllMintsResults().then(() => {
                backtestPubSub.publishBacktestStrategyMintResult('bt3', 'st3', { value: 30 });
                backtestPubSub.subscribeAllMintsResults(handler);
                backtestPubSub.publishBacktestStrategyMintResult('bt4', 'st4', { value: 40 });
            });
        });

        it('should receive single strategy result', done => {
            const handler = (data: { score: number }, channel: string) => {
                expect(channel).toBe('backtest:bt1:strategy:st1:result');
                expect(data.score).toBe(99);
                done();
            };
            backtestPubSub.subscribeBacktestStrategyResult('bt1', 'st1', handler);
            backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 99 });
        });

        it('should receive all strategy results for a backtest', done => {
            const received: number[] = [];
            const handler = (data: { score: number }) => {
                received.push(data.score);
                if (received.length === 2) {
                    expect(received).toContain(7);
                    expect(received).toContain(8);
                    done();
                }
            };
            backtestPubSub.subscribeBacktestAllStrategyResults('bt1', handler);
            backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 7 });
            backtestPubSub.publishBacktestStrategyResult('bt1', 'st2', { score: 8 });
        });

        it('should receive all strategy results across all backtests', done => {
            const received: number[] = [];

            const handler = (data: { score: number }) => {
                received.push(data.score);
                if (received.length === 2) {
                    expect(received).toContain(100);
                    expect(received).toContain(200);
                    done();
                }
            };
            backtestPubSub.subscribeAllBacktestsStrategyResults(handler);
            backtestPubSub.publishBacktestStrategyResult('bt1', 'st1', { score: 100 });
            backtestPubSub.publishBacktestStrategyResult('bt2', 'st2', { score: 200 });
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
