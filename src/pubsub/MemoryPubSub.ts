import PubSub from './PubSub';

type MessageHandler = (message: string, channel: string) => void;

export default class MemoryPubSub implements PubSub {
    private channels: Map<string, MessageHandler[]> = new Map();
    private patterns: Map<string, MessageHandler[]> = new Map();

    async publish(channel: string, message: string): Promise<void> {
        // Call exact channel subscribers
        const handlers = this.channels.get(channel) || [];
        handlers.forEach(h => h(message, channel));

        // Call pattern subscribers
        for (const [pattern, pHandlers] of this.patterns.entries()) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            if (regex.test(channel)) {
                pHandlers.forEach(h => h(message, channel));
            }
        }
    }

    async subscribe(channel: string, handler: MessageHandler): Promise<void> {
        const handlers = this.channels.get(channel) || [];
        handlers.push(handler);
        this.channels.set(channel, handlers);
    }

    async unsubscribe(channel: string): Promise<void> {
        this.channels.delete(channel);
    }

    // -----------------------------
    // Pattern subscription
    // -----------------------------
    async psubscribe(pattern: string, handler: MessageHandler): Promise<void> {
        const handlers = this.patterns.get(pattern) || [];
        handlers.push(handler);
        this.patterns.set(pattern, handlers);
    }

    async punsubscribe(pattern: string): Promise<void> {
        this.patterns.delete(pattern);
    }

    async close(): Promise<void> {
        this.channels.clear();
        this.patterns.clear();
    }
}
