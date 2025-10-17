import Redis from 'ioredis';

import { redis } from '@src/cache/cache';
import { logger } from '@src/logger';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';

import MemoryPubSub from './MemoryPubSub';
import PubSub from './PubSub';
import RedisPubSub from './RedisPubSub';

let pubsub: PubSub;
let backtestPubSub: BacktestPubSub;

export function createPubSub(): PubSub {
    if (!pubsub) {
        const backend = process.env.PUBSUB_BACKEND || 'memory';
        pubsub =
            backend === 'redis'
                ? /**
                   * We will use a separate pub and sub redis instance
                   * When a Redis client is in subscriber mode, it can’t issue normal commands like PUBLISH or SET.
                   * Using the same instance for both may cause blocking issues depending on timing.
                   * ioredis internally creates a duplicate connection for subscribe() calls, but explicitly separating them avoids confusion and unexpected reconnects.
                   */
                  new RedisPubSub({
                      logger: logger,
                      pub: redis,
                      sub: createRedisConnection(),
                      isPubShared: true,
                  })
                : new MemoryPubSub();
    }

    return pubsub;
}

export function createBacktestPubSub(): BacktestPubSub {
    if (!backtestPubSub) {
        backtestPubSub = new BacktestPubSub(createPubSub());
    }
    return backtestPubSub;
}

function createRedisConnection(): Redis {
    return new Redis({
        host: process.env.REDIS_HOST as string,
        port: parseInt(process.env.REDIS_PORT as string),
    });
}
