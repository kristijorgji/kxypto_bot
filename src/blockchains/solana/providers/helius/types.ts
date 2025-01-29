import { Asset } from '../../types';

export type HeliusConfig = {
    rpcUrl: string;
    apiKey: string;
};

type PaginatedResultResponse<T> = {
    result: T;
    page: number;
    total: number;
    limit: number;
};

export type HeliusGetTokenAccountsResponse = PaginatedResultResponse<{
    token_accounts: {
        address: string; // unique address for this  token for the given owner, each owner has its own token address
        owner: string; // owner address account
        amount: number;
        mint: string; // token mint
    }[];
}>;

export type HeliusGetAssetsByOwnerResponse = PaginatedResultResponse<{
    items: Asset[];
}>;
