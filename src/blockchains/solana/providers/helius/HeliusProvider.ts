import { HeliusConfig, HeliusGetAssetsByOwnerResponse, HeliusGetTokenAccountsResponse } from './types';
import { Asset, TokenHolder } from '../../types';

export default class HeliusProvider {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly config: HeliusConfig) {}

    async getTokenHolders(config: HeliusConfig, token: string): Promise<TokenHolder[]> {
        let page = 1;
        const allOwners = new Set<TokenHolder>();

        while (true) {
            const response = await fetch(`${config.rpcUrl}/?api-key=${config.apiKey}`, {
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
                        limit: 1000,
                        mint: token,
                    },
                }),
            });
            const data = (await response.json()) as HeliusGetTokenAccountsResponse;

            if (!data.result || data.result.token_accounts.length === 0) {
                break;
            }

            data.result.token_accounts.forEach(account => {
                allOwners.add({
                    address: account.owner,
                    amount: account.amount,
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
