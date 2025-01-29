export type TokenHolder = {
    address: string;
    amount: number;
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
