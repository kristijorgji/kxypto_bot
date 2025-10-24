import { reviveDates } from '@src/utils/json';

import PubSub from './PubSub';

type Handler<T> = (data: T, channel: string) => void;

/**
 * Channels:
 * - backtest:<backtestId>:strategy:<strategyId>:mint    -> Backtest Strategy Token/mint result finished
 * - backtest:<backtestId>:strategy:<strategyId>:result  -> Backtest Strategy result finished
 */
export default class BacktestPubSub {
    constructor(private pubsub: PubSub) {}

    private patterns = {
        allStrategyResults: 'backtest:*:strategy:*:result',
        allMintResults: 'backtest:*:strategy:*:mint',
    };

    // -----------------------------
    // SUBSCRIPTIONS
    // -----------------------------

    // Subscribe to a single backtest strategy mint
    subscribeBacktestStrategyMint<T>(backtestId: string, strategyId: string, handler: Handler<T>): void {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:mint`;
        this.subscribeChannel(channel, handler);
    }

    // Subscribe to all mints of a single backtest (all strategies)
    subscribeBacktestAllMints<T>(backtestId: string, handler: Handler<T>): void {
        const pattern = `backtest:${backtestId}:strategy:*:mint`;
        this.subscribePattern(pattern, handler);
    }

    // Subscribe to all strategy results across all backtests
    subscribeAllStrategyResults<T>(handler: Handler<T>): void {
        this.subscribePattern(this.patterns.allStrategyResults, handler);
    }

    async unsubscribeAllStrategyResults(): Promise<void> {
        await this.pubsub.punsubscribe(this.patterns.allStrategyResults);
    }

    // Subscribe to all mints across all backtests
    subscribeAllMintsResults<T>(handler: Handler<T>): void {
        this.subscribePattern(this.patterns.allMintResults, handler);
    }

    async unsubscribeAllMintsResults(): Promise<void> {
        await this.pubsub.punsubscribe(this.patterns.allMintResults);
    }

    // Subscribe to a single backtest strategy result
    subscribeBacktestStrategyResult<T>(backtestId: string, strategyId: string, handler: Handler<T>): void {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:result`;
        this.subscribeChannel(channel, handler);
    }

    // Subscribe to all results of a single backtest (all strategies)
    subscribeBacktestAllStrategyResults<T>(backtestId: string, handler: Handler<T>): void {
        const pattern = `backtest:${backtestId}:strategy:*:result`;
        this.subscribePattern(pattern, handler);
    }

    // Subscribe to all results across all backtests
    subscribeAllBacktestsStrategyResults<T>(handler: Handler<T>): void {
        const pattern = 'backtest:*:strategy:*:result';
        this.subscribePattern(pattern, handler);
    }

    // -----------------------------
    // PUBLISHERS
    // -----------------------------

    publishBacktestStrategyMintResult<T>(backtestId: string, strategyId: string, data: T): void {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:mint`;
        this.publishChannel(channel, data);
    }

    publishBacktestStrategyResult<T>(backtestId: string, strategyId: string, data: T): void {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:result`;
        this.publishChannel(channel, data);
    }

    // -----------------------------
    // INTERNAL HELPERS
    // -----------------------------

    private subscribeChannel<T>(channel: string, handler: Handler<T>): void {
        this.pubsub.subscribe(channel, (message: string) => {
            handler(JSON.parse(message, reviveDates) as T, channel);
        });
    }

    private subscribePattern<T>(pattern: string, handler: Handler<T>): void {
        this.pubsub.psubscribe(pattern, (message: string, channel: string) => {
            handler(JSON.parse(message, reviveDates) as T, channel);
        });
    }

    private publishChannel<T>(channel: string, data: T): void {
        const message = JSON.stringify(data);
        this.pubsub.publish(channel, message);
    }
}
