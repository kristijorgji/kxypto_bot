export interface CircuitBreakerError extends Error {
    code: string;
}

export type RetryConfig = {
    maxRetries: number;
    sleepMs: number | ((retryCount: number) => number);
};
