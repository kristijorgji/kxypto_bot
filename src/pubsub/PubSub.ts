export default interface PubSub {
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string, handler: (message: string) => void): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    psubscribe(pattern: string, handler: (message: string, channel: string) => void): Promise<void>;
    punsubscribe(pattern: string): Promise<void>;
    close(): Promise<void>;
}
