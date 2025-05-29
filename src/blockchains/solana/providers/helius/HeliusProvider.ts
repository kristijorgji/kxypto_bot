import { HeliusConfig, HeliusGetAssetsByOwnerResponse, HeliusGetTokenAccountsResponse } from './types';
import { Asset, TokenHolder } from '../../types';

export default class HeliusProvider {
    constructor(private readonly config: HeliusConfig) {}

    async getTokenHolders({
        tokenAddress,
        maxToFetch,
    }: {
        tokenAddress: string;
        maxToFetch?: number;
    }): Promise<TokenHolder[]> {
        const batchSize = 1000;
        let totalCount = 0;
        let page = 1;
        const allOwners = new Set<TokenHolder>();

        // eslint-disable-next-line no-unmodified-loop-condition
        while (!maxToFetch || totalCount < maxToFetch) {
            const response = await fetch(`${this.config.rpcUrl}/?api-key=${this.config.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'getTokenAccounts',
                    id: '421',
                    params: {
                        page: page,
                        limit: maxToFetch
                            ? Math.min(maxToFetch, Math.min(batchSize, maxToFetch - totalCount))
                            : batchSize,
                        mint: tokenAddress,
                    },
                }),
            });
            const data = (await response.json()) as HeliusGetTokenAccountsResponse;

            if (!data.result || data.result.token_accounts.length === 0) {
                break;
            }

            data.result.token_accounts.forEach(account => {
                totalCount++;
                allOwners.add({
                    tokenAccountAddress: account.address,
                    ownerAddress: account.owner,
                    balance: account.amount,
                });
            });
            page++;
        }

        return Array.from(allOwners);
    }

    async getAssetsByOwner(config: HeliusConfig, ownerAddress: string): Promise<Asset[]> {
        let page = 1;

        const assets: Asset[] = [];

        while (true) {
            const response = await fetch(`${config.rpcUrl}/?api-key=${config.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'my-id',
                    method: 'getAssetsByOwner',
                    params: {
                        ownerAddress: ownerAddress,
                        page: page,
                        limit: 1000,
                        displayOptions: {
                            showFungible: true,
                        },
                    },
                }),
            });

            const data = (await response.json()) as HeliusGetAssetsByOwnerResponse;

            if (!data.result || data.result.items.length === 0) {
                break;
            }

            assets.push(...data.result.items);
            page++;
        }

        return assets;
    }
}
