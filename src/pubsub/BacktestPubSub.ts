import { ProtoBacktestRun } from '@src/protos/generated/backtests';
import { reviveDates } from '@src/utils/json';
import { UpdateItem } from '@src/ws-api/types';

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
        allRunsResult: 'backtestRun:*',
        allStrategyResults: 'backtest:*:strategy:*:result',
        allMintResults: 'backtest:*:strategy:*:mint',
    };

    // -----------------------------
    // SUBSCRIPTIONS
    // -----------------------------

    async subscribeAllRuns<T>(handler: Handler<T>): Promise<void> {
        await this.subscribePattern(this.patterns.allRunsResult, handler);
    }

    async unsubscribeAllRuns(): Promise<void> {
        await this.pubsub.punsubscribe(this.patterns.allRunsResult);
    }

    // Subscribe to a single backtest strategy mint
    async subscribeBacktestStrategyMint<T>(backtestId: string, strategyId: string, handler: Handler<T>): Promise<void> {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:mint`;
        await this.subscribeChannel(channel, handler);
    }

    // Subscribe to all mints of a single backtest (all strategies)
    async subscribeBacktestAllMints<T>(backtestId: string, handler: Handler<T>): Promise<void> {
        const pattern = `backtest:${backtestId}:strategy:*:mint`;
        await this.subscribePattern(pattern, handler);
    }

    // Subscribe to all strategy results across all backtests
    async subscribeAllStrategyResults<T>(handler: Handler<T>): Promise<void> {
        await this.subscribePattern(this.patterns.allStrategyResults, handler);
    }

    async unsubscribeAllStrategyResults(): Promise<void> {
        await this.pubsub.punsubscribe(this.patterns.allStrategyResults);
    }

    // Subscribe to all mints across all backtests
    async subscribeAllMintsResults<T>(handler: Handler<T>): Promise<void> {
        await this.subscribePattern(this.patterns.allMintResults, handler);
    }

    async unsubscribeAllMintsResults(): Promise<void> {
        await this.pubsub.punsubscribe(this.patterns.allMintResults);
    }

    // Subscribe to a single backtest strategy result
    async subscribeBacktestStrategyResult<T>(
        backtestId: string,
        strategyId: string,
        handler: Handler<T>,
    ): Promise<void> {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:result`;
        await this.subscribeChannel(channel, handler);
    }

    // Subscribe to all results of a single backtest (all strategies)
    async subscribeBacktestAllStrategyResults<T>(backtestId: string, handler: Handler<T>): Promise<void> {
        const pattern = `backtest:${backtestId}:strategy:*:result`;
        await this.subscribePattern(pattern, handler);
    }

    // Subscribe to all results across all backtests
    async subscribeAllBacktestsStrategyResults<T>(handler: Handler<T>): Promise<void> {
        const pattern = 'backtest:*:strategy:*:result';
        await this.subscribePattern(pattern, handler);
    }

    // -----------------------------
    // PUBLISHERS
    // -----------------------------

    async publishBacktestRun(data: UpdateItem<ProtoBacktestRun>): Promise<void> {
        const channel = `backtestRun:${data.id}`;
        await this.publishChannel(channel, data);
    }

    async publishBacktestStrategyMintResult<T>(backtestId: string, strategyId: string, data: T): Promise<void> {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:mint`;
        await this.publishChannel(channel, data);
    }

    async publishBacktestStrategyResult<T>(backtestId: string, strategyId: string, data: T): Promise<void> {
        const channel = `backtest:${backtestId}:strategy:${strategyId}:result`;
        await this.publishChannel(channel, data);
    }

    // -----------------------------
    // INTERNAL HELPERS
    // -----------------------------

    private async subscribeChannel<T>(channel: string, handler: Handler<T>): Promise<void> {
        await this.pubsub.subscribe(channel, (message: string) => {
            handler(JSON.parse(message, reviveDates) as T, channel);
        });
    }

    private async subscribePattern<T>(pattern: string, handler: Handler<T>): Promise<void> {
        await this.pubsub.psubscribe(pattern, (message: string, channel: string) => {
            handler(JSON.parse(message, reviveDates) as T, channel);
        });
    }

    private async publishChannel<T>(channel: string, data: T): Promise<void> {
        const message = JSON.stringify(data);
        await this.pubsub.publish(channel, message);
    }
}
