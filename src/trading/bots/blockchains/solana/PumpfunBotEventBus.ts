import EventEmitter from 'node:events';

import { BotTradeResponse, TradeTransaction } from './types';

export type StopBotReason = 'max_open_positions' | 'max_full_trades' | 'min_wallet_balance' | 'insufficient_funds';

export type StopBotArgs = {
    reason: StopBotReason;
    excludeBotIds?: Set<string> | null;
};

export default class PumpfunBotEventBus {
    private readonly eventEmitter: EventEmitter = new EventEmitter();

    constructor() {
        this.eventEmitter.setMaxListeners(0);
    }

    tradeExecuted(botId: string, transaction: TradeTransaction): void {
        this.eventEmitter.emit('tradeExecuted', botId, transaction);
    }

    onTradeExecuted(listener: (botId: string, transaction: TradeTransaction) => void) {
        this.eventEmitter.on('tradeExecuted', listener);
    }

    botTradeResponse(botId: string, response: BotTradeResponse): void {
        this.eventEmitter.emit('botResponse', botId, response);
    }

    onBotTradeResponse(listener: (botId: string, response: BotTradeResponse) => void) {
        this.eventEmitter.on('botResponse', listener);
    }

    stopBot(_requestingBotId: string | null, reason: StopBotReason): void {
        this.eventEmitter.emit('stopBot', {
            reason: reason,
        } satisfies StopBotArgs);
    }

    onStopBot(listener: (args: StopBotArgs) => void): void {
        this.eventEmitter.on('stopBot', listener);
    }
}
