import EventEmitter from 'node:events';

import { BotTradeResponse, TradeTransaction } from './types';

export default class PumpfunBotEventBus {
    private readonly eventEmitter: EventEmitter = new EventEmitter();

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

    stopBot(): void {
        this.eventEmitter.emit('stopBot');
    }

    onStopBot(listener: () => void): void {
        this.eventEmitter.on('stopBot', listener);
    }
}
