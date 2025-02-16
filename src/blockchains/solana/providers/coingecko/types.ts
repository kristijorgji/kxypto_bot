export enum Coins {
    SOL = 'solana',
    BTC = 'bitcoin',
}

export enum Currencies {
    USD = 'usd',
    EUR = 'eur',
}

export type ExchangeRateResponse = {
    coin: Coins;
    currency: Currencies;
    rate: number | null;
};

export type ExchangeRateConfig = {
    coin: Coins;
    currency: Currencies;
};

export type CoinGeckoExchangeRateResponse = {
    [K in Coins]?: {
        [C in Currencies]?: number;
    };
};
