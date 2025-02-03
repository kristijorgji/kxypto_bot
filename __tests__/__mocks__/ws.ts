import { WebSocket as MockWebSocket } from 'mock-socket';

class CustomMockWebSocket extends MockWebSocket {
    // Store event listeners
    listeners: { [key: string]: Function[] } = {};
    static sendMockFn = jest.fn();

    // eslint-disable-next-line no-useless-constructor
    constructor(url: string) {
        super(url);
    }

    // Override the `on()` method to support custom event listeners
    public on(event: string, callback: Function): void {
        // Initialize the event listener array if not already present
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        // Add the event listener
        this.listeners[event].push(callback);

        // Call the corresponding `super` method if needed
        if (event === 'open' && this.readyState === WebSocket.OPEN) {
            callback();
        }
    }

    // Override the dispatch of events so that the custom listeners are called
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public trigger(event: string, ...args: any[]): void {
        // Call all listeners for this event
        if (this.listeners[event]) {
            this.listeners[event].forEach(listener => {
                listener(...args);
            });
        }
    }

    // You can mock other WebSocket behavior if necessary (e.g., send, close)
    public send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
        console.log('Mock sending data:', data);
        CustomMockWebSocket.sendMockFn(...arguments);
    }

    // You can also mock the close event and trigger the listeners for 'close'
    public close(): void {
        console.log('Mock WebSocket closed');
        this.trigger('close');
    }
}

// Export the extended WebSocket class
export { CustomMockWebSocket as default };
