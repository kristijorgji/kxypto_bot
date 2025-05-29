export const FileStorage = {
    Local: 'local',
    S3: 's3',
} as const;
export type FileStorageType = (typeof FileStorage)[keyof typeof FileStorage];

export interface CircuitBreakerError extends Error {
    code: string;
}

export type RetryConfig = {
    maxRetries: number;
    sleepMs: number | ((retryCount: number) => number);
};
