const JITO_MAINNET_ENDPOINTS = [
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://mainnet.block-engine.jito.wtf',
    'https://ny.mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf',
    'https://slc.mainnet.block-engine.jito.wtf',
] as const;

export type JitoEndpoint = (typeof JITO_MAINNET_ENDPOINTS)[number];

const TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

const getRandomJitoMainnetEndpoint = (): JitoEndpoint => {
    return JITO_MAINNET_ENDPOINTS[Math.floor(Math.random() * JITO_MAINNET_ENDPOINTS.length)] as JitoEndpoint;
};

export type JitoConfig = {
    jitoEnabled: boolean;
    endpoint?: JitoEndpoint;
    tipLamports?: number;
};

export const TIP_LAMPORTS = 150000; // 0,00015 SOL

/**
 * https://docs.jito.wtf/lowlatencytxnsend/#getting-started
 * https://github.com/jito-labs/jito-js-rpc/blob/master/src/index.js
 * https://github.dev/rayorole/pumpdotfun-sdk#readme
 */
export default class Jito {
    constructor(private readonly config?: { endpoint?: JitoEndpoint }) {}

    /**
     * Gets a random tip account from the fetched list
     */
    getRandomTipAccount(): string {
        const randomIndex = Math.floor(Math.random() * TIP_ACCOUNTS.length);
        return TIP_ACCOUNTS[randomIndex];
    }

    async sendTransaction(transaction: string, endpoint?: JitoEndpoint): Promise<string> {
        const response = await fetch(`${endpoint ?? this.endpoint()}/api/v1/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sendTransaction',
                params: [transaction, { encoding: 'base64' }],
            }),
        });

        if (response.status !== 200) {
            throw response;
        }

        const body = (await response.json()) as unknown as { result: string };

        return body.result;
    }

    /**
     * Sends a bundle of transactions to the Jito block engine API
     */
    async sendBundle(
        transactions: string[],
        endpoint?: JitoEndpoint,
    ): Promise<{
        bundleId: string;
    }> {
        const response = await fetch(`${endpoint ?? this.endpoint()}/api/v1/bundles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sendBundle',
                params: [transactions, { encoding: 'base64' }],
            }),
        });

        if (response.status !== 200) {
            throw response;
        }

        const body = (await response.json()) as unknown as {
            result: string;
        };

        return {
            bundleId: body.result,
        };
    }

    private endpoint(): string {
        return this.config?.endpoint ?? getRandomJitoMainnetEndpoint();
    }
}

export const jitoClient = new Jito();
