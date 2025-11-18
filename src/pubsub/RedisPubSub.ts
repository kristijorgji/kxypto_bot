import Redis, { RedisOptions } from 'ioredis';
import { Logger } from 'winston';

import PubSub from './PubSub';

type MessageHandler = (message: string, channel: string) => void;

export interface RedisPubSubConfig {
    logger: Logger;

    /** Existing Redis instance or configuration for the publisher */
    pub?: Redis;
    pubConfig?: RedisOptions;

    /** Existing Redis instance or configuration for the subscriber */
    sub?: Redis;
    subConfig?: RedisOptions;

    /** Whether the pub instance is shared and should not be closed by this class */
    isPubShared?: boolean;
}

/**
 * Robust Redis-based Pub/Sub implementation with support for:

 * - subscribe / psubscribe (pattern)
 * - dependency injection
 * - graceful shutdown
 * - memory-safe listener management
 * - uses promise-based subscribe/psubscribe so it's compatible with ioredis-mock and real ioredis.
 */
export default class RedisPubSub implements PubSub {
    private pub: Redis;
    private sub: Redis;
    private logger: Logger;
    private isClosed = false;

    // Support multiple handlers per channel/pattern
    private channelHandlers: Map<string, MessageHandler[]> = new Map();
    private patternHandlers: Map<string, MessageHandler[]> = new Map();

    constructor({ logger, pub, sub, pubConfig, subConfig, isPubShared = false }: RedisPubSubConfig) {
        this.logger = logger;

        this.pub =
            pub ?? new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), ...pubConfig });
        this.sub =
            sub ??
            new Redis({
                host: process.env.REDIS_HOST,
                port: Number(process.env.REDIS_PORT),
                retryStrategy: times => Math.min(times * 100, 3000),
                ...subConfig,
            });

        // Init global listeners once
        this.sub.on('connect', () => this.logger.info('[RedisPubSub] Subscriber connected'));
        this.sub.on('reconnecting', () => this.logger.warn('[RedisPubSub] Subscriber reconnecting...'));
        this.sub.on('error', err => this.logger.error('[RedisPubSub] Redis error:', err));
        this.sub.on('end', () => {
            if (!this.isClosed) this.logger.error('[RedisPubSub] Subscriber connection ended unexpectedly');
        });

        // Normal channel messages
        this.sub.on('message', (channel, message) => {
            const handlers = this.channelHandlers.get(channel);
            if (handlers) {
                handlers.forEach(h => {
                    try {
                        h(message, channel);
                    } catch (err) {
                        this.logger.error('[RedisPubSub] Channel handler error:', err);
                    }
                });
            }
        });

        // Pattern-based messages
        this.sub.on('pmessage', (pattern, channel, message) => {
            const handlers = this.patternHandlers.get(pattern);
            if (handlers) {
                handlers.forEach(h => {
                    try {
                        h(message, channel);
                    } catch (err) {
                        this.logger.error('[RedisPubSub] Pattern handler error:', err);
                    }
                });
            }
        });

        // Keep track of whether the pub is shared
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (isPubShared) (this.pub as any).isShared = true;
    }

    async publish(channel: string, message: string): Promise<void> {
        try {
            await this.pub.publish(channel, message);
        } catch (err) {
            this.logger.error(`[RedisPubSub] Failed to publish to ${channel}:`, err);
        }
    }

    async subscribe(channel: string, handler: MessageHandler): Promise<void> {
        if (!this.channelHandlers.has(channel)) {
            this.channelHandlers.set(channel, []);
            await this.sub.subscribe(channel);
            this.logger.info(`[RedisPubSub] Subscribed to channel: ${channel}`);
        }
        this.channelHandlers.get(channel)!.push(handler);
    }

    async psubscribe(pattern: string, handler: MessageHandler): Promise<void> {
        if (!this.patternHandlers.has(pattern)) {
            this.patternHandlers.set(pattern, []);
            await this.sub.psubscribe(pattern);
            this.logger.info(`[RedisPubSub] Pattern-subscribed to: ${pattern}`);
        }
        this.patternHandlers.get(pattern)!.push(handler);
    }

    async unsubscribe(channel: string): Promise<void> {
        try {
            await this.sub.unsubscribe(channel);
            this.channelHandlers.delete(channel);
            this.logger.info(`[RedisPubSub] Unsubscribed from channel: ${channel}`);
        } catch (err) {
            this.logger.error(`[RedisPubSub] Failed to unsubscribe from ${channel}:`, err);
        }
    }

    async punsubscribe(pattern: string): Promise<void> {
        try {
            await this.sub.punsubscribe(pattern);
            this.patternHandlers.delete(pattern);
            this.logger.info(`[RedisPubSub] Pattern-unsubscribed from: ${pattern}`);
        } catch (err) {
            this.logger.error(`[RedisPubSub] Failed to punsubscribe from ${pattern}:`, err);
        }
    }

    async close(): Promise<void> {
        if (this.isClosed) return;
        this.isClosed = true;

        try {
            await this.sub.quit();
            this.logger.info('[RedisPubSub] Closed subscriber connection');
        } catch (err) {
            this.logger.error('[RedisPubSub] Error closing subscriber:', err);
        }

        try {
            // Don't quit shared pub connection unless it's not reused elsewhere
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(this.pub as any).isShared) {
                await this.pub.quit();
                this.logger.info('[RedisPubSub] Closed publisher connection');
            }
        } catch (err) {
            this.logger.error('[RedisPubSub] Error closing publisher:', err);
        }
    }
}
