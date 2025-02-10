export type WalletInfo = { privateKey: string; address: string };

export enum TransactionMode {
    Simulation,
    Execution,
}

export type TokenHolder = {
    address: string;
    amount: number;
};

export type IfpsMetadata = {
    name: string;
    symbol: string;
    description: string;
    showName?: boolean;
    image: string;
    createdOn: string;
    twitter?: string;
    telegram?: string;
    website?: string;
};

export type TokenInWalletFullInfo = {
    associatedTokenAddress: string; // this account holds token of this type only for the associated owner
    mint: string;
    name: string;
    symbol: string;
    amountRaw: number;
    amount: string;
    decimals: number;
    ifpsMetadata?: IfpsMetadata;
};

export type Asset = {
    id: string;
    interface: 'FungibleToken' | 'NonFungibleToken';
    content: {
        $schema: string;
        metadata: {
            name: string;
            symbol: string;
        };
        links: {
            image: string;
        };
    };
    royalty: {
        primary_sale_happened: boolean;
        locked: boolean;
    };
    ownership: {
        frozen: boolean;
        delegated: boolean;
        ownership_model: 'token';
        owner: string;
    };
    token_info: {
        symbol: string;
        balance: number;
        supply: number;
        decimals: number;
        token_program: string;
        associated_token_address: string;
        price_info: {
            price_per_token: number;
            total_price: number;
            currency: string;
        };
        mint_authority: string;
        freeze_authority: string;
    };
};

export type WssMessage = {
    jsonrpc: '2.0';
    method: string;
    params: {
        result: {
            context: {
                slot: number;
            };
            value: {
                signature: string;
                err: null;
                logs?: string[];
            };
        };
        subscription: number;
    };
};

export type SolTransactionDetails = {
    grossTransferredLamports: number; // Amount before fees
    netTransferredLamports: number; // Amount after fees
    baseFeeLamports: number;
    priorityFeeLamports: number;
    totalFeeLamports: number;
};
