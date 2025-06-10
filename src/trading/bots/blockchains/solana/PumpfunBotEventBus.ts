import EventEmitter from 'node:events';

import { BotTradeResponse, TradeTransaction } from './types';

export type StopBotReason = 'max_open_positions' | 'max_full_trades' | 'min_wallet_balance' | 'insufficient_funds';

export default class PumpfunBotEventBus {
    private readonly eventEmitter: EventEmitter = new EventEmitter();

    constructor() {
        this.eventEmitter.setMaxListeners(0);
    }

    tradeExecuted(transaction: TradeTransaction): void {
        this.eventEmitter.emit('tradeExecuted', transaction);
    }

    onTradeExecuted(listener: (transaction: TradeTransaction) => void) {
        this.eventEmitter.on('tradeExecuted', listener);
    }

    botTradeResponse(response: BotTradeResponse): void {
        this.eventEmitter.emit('botResponse', response);
    }

    onBotTradeResponse(listener: (response: BotTradeResponse) => void) {
        this.eventEmitter.on('botResponse', listener);
    }

    stopBot(reason: StopBotReason): void {
        this.eventEmitter.emit('stopBot', {
            reason: reason,
        });
    }

    onStopBot(listener: (args: { reason: StopBotReason }) => void): void {
        this.eventEmitter.on('stopBot', listener);
    }
}
