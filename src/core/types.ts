import { z } from 'zod';

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

export const dataSourceSchema = z.object({
    path: z.string(),
    includeIfPathContains: z.array(z.string()).optional(),
});

export type DataSource = z.infer<typeof dataSourceSchema>;

export enum ActionSource {
    ApiClient = 'api_client',
    Cli = 'cli',
    App = 'app',
    System = 'system',
}

type ActorBase = {
    source: ActionSource;
    userId?: string;
    apiClientId?: string;
};

export type ActorContext =
    | (ActorBase & { source: ActionSource.ApiClient; apiClientId: string })
    | (ActorBase & { source: ActionSource.Cli | ActionSource.App; userId: string })
    | (ActorBase & { source: ActionSource.System });
