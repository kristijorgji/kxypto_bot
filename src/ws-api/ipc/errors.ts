export class IpcTimeoutError extends Error {
    public readonly timeoutMs: number;
    public readonly method: string;

    constructor(method: string, timeoutMs: number) {
        const defaultMessage = `IPC request to '${method}' timed out after ${timeoutMs}ms`;
        super(defaultMessage);

        this.name = 'IpcTimeoutError';
        this.method = method;
        this.timeoutMs = timeoutMs;

        // Required for 'instanceof' to work correctly when targeting older environments
        Object.setPrototypeOf(this, IpcTimeoutError.prototype);

        // Captures a clean stack trace (standard in V8/Node.js environments)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, IpcTimeoutError);
        }
    }
}
