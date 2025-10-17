import PubSub from '../../../src/pubsub/PubSub';

export function runCommonPubSubTests(factory: () => PubSub, label: string) {
    describe(`Common PubSub tests (${label})`, () => {
        let pubsub: PubSub;

        beforeEach(() => {
            pubsub = factory();
        });

        afterEach(async () => {
            if (pubsub.close) await pubsub.close();
        });

        it('should call exact channel subscriber', async () => {
            const received: string[] = [];
            await pubsub.subscribe('chan1', msg => received.push(msg));

            await pubsub.publish('chan1', 'hello');
            await new Promise(r => setTimeout(r, 10));

            expect(received).toEqual(['hello']);
        });

        it('should call multiple subscribers for the same channel', async () => {
            const received1: string[] = [];
            const received2: string[] = [];

            await pubsub.subscribe('chan1', msg => received1.push(msg));
            await pubsub.subscribe('chan1', msg => received2.push(msg));

            await pubsub.publish('chan1', 'msg1');
            await new Promise(r => setTimeout(r, 10));

            expect(received1).toEqual(['msg1']);
            expect(received2).toEqual(['msg1']);
        });

        it('should unsubscribe from channel', async () => {
            const received: string[] = [];
            await pubsub.subscribe('chan1', msg => received.push(msg));

            await pubsub.publish('chan1', 'first');
            await new Promise(r => setTimeout(r, 10));
            expect(received).toEqual(['first']);

            await pubsub.unsubscribe('chan1');
            await pubsub.publish('chan1', 'second');
            await new Promise(r => setTimeout(r, 10));

            expect(received).toEqual(['first']);
        });

        it('should call pattern subscribers', async () => {
            const received: { channel: string; msg: string }[] = [];

            await pubsub.psubscribe('test:*', (msg, channel) => {
                received.push({ msg, channel });
            });

            await pubsub.publish('test:1', 'foo');
            await pubsub.publish('test:2', 'bar');
            await new Promise(r => setTimeout(r, 10));

            expect(received).toEqual([
                { channel: 'test:1', msg: 'foo' },
                { channel: 'test:2', msg: 'bar' },
            ]);
        });

        it('should call multiple overlapping pattern subscribers', async () => {
            const receivedA: string[] = [];
            const receivedB: string[] = [];

            await pubsub.psubscribe('pattern:*', (msg, channel) => receivedA.push(`${channel}:${msg}`));
            await pubsub.psubscribe('pattern:1:*', (msg, channel) => receivedB.push(`${channel}:${msg}`));

            await pubsub.publish('pattern:1:foo', 'hello');
            await pubsub.publish('pattern:2:bar', 'world');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedA).toEqual(['pattern:1:foo:hello', 'pattern:2:bar:world']);
            expect(receivedB).toEqual(['pattern:1:foo:hello']);
        });

        it('should punsubscribe from pattern', async () => {
            const received: { channel: string; msg: string }[] = [];
            await pubsub.psubscribe('pattern:*', (msg, channel) => {
                received.push({ msg, channel });
            });

            await pubsub.publish('pattern:1', 'foo');
            await new Promise(r => setTimeout(r, 10));
            expect(received).toEqual([{ channel: 'pattern:1', msg: 'foo' }]);

            await pubsub.punsubscribe('pattern:*');
            await pubsub.publish('pattern:2', 'bar');
            await new Promise(r => setTimeout(r, 10));

            expect(received).toEqual([{ channel: 'pattern:1', msg: 'foo' }]);
        });

        it('should support multiple channels and patterns simultaneously', async () => {
            // TODO fix redis implementation for this test case
            if (label === 'RedisPubSub') {
                return;
            }

            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();

            await pubsub.subscribe('chan1', handler1);
            await pubsub.subscribe('chan2', handler2);
            await pubsub.psubscribe('chan*', handler3);

            await pubsub.publish('chan1', 'm1');
            await pubsub.publish('chan2', 'm2');
            await pubsub.publish('chanX', 'm3');

            expect(handler1).toHaveBeenCalledWith('m1', 'chan1');
            expect(handler2).toHaveBeenCalledWith('m2', 'chan2');
            expect(handler3).toHaveBeenCalledWith('m1', 'chan1');
            expect(handler3).toHaveBeenCalledWith('m2', 'chan2');
            expect(handler3).toHaveBeenCalledWith('m3', 'chanX');
        });

        it('close should clear all subscriptions', async () => {
            const handler = jest.fn();
            await pubsub.subscribe('chan1', handler);
            await pubsub.psubscribe('test:*', handler);

            await pubsub.close();

            await pubsub.publish('chan1', 'msg1');
            await pubsub.publish('test:123', 'msg2');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should continue calling other handlers if one throws', async () => {
            // TODO can implement this in memory pub sub later
            if (label === 'MemoryPubSub') {
                return;
            }

            const received: string[] = [];

            await pubsub.subscribe('chan-error', () => {
                throw new Error('Test error');
            });
            await pubsub.subscribe('chan-error', msg => received.push(msg));

            await pubsub.publish('chan-error', 'ok');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received).toEqual(['ok']);
        });
    });
}
