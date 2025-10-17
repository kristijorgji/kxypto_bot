import redisMock from 'ioredis-mock';
import { Logger, createLogger } from 'winston';

import { runCommonPubSubTests } from './pubsub.shared-tests';
import RedisPubSub from '../../../src/pubsub/RedisPubSub';

const silentLogger = createLogger({ silent: true, transports: [] });
const redisPubSubFactory = () => {
    const pub = new redisMock();
    const sub = new redisMock();
    return new RedisPubSub({ logger: silentLogger, pub, sub, isPubShared: true });
};

runCommonPubSubTests(redisPubSubFactory, 'RedisPubSub');

describe('RedisPubSub - specific behavior', () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
        pubsub = redisPubSubFactory();
    });

    afterEach(async () => {
        await pubsub.close();
    });

    it('should log on connect and reconnect events', () => {
        const pub = new redisMock();
        const sub = new redisMock();
        const logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Logger;

        new RedisPubSub({ logger, pub, sub });
        sub.emit('connect');
        sub.emit('reconnecting');

        expect(logger.info).toHaveBeenCalledWith('[RedisPubSub] Subscriber connected');
        expect(logger.warn).toHaveBeenCalledWith('[RedisPubSub] Subscriber reconnecting...');
    });

    it('should not close shared pub instance', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pubAny = pubsub['pub'] as any;
        await pubsub.close();
        expect(pubAny.isShared).toBe(true);
    });
});
