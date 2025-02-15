import axiosFactory from 'axios';
import { setupCache } from 'axios-cache-interceptor';

import { logger } from '../../../../logger';

export enum Coins {
    SOL = 'solana',
    BTC = 'bitcoin',
}

export enum Currencies {
    USD = 'usd',
    EUR = 'eur',
}

// Usage in the response type
export type ExchangeRateResponse = {
    coin: Coins;
    currency: Currencies;
    rate: number | null;
};

export type ExchangeRateConfig = {
    coin: Coins;
    currency: Currencies;
};

type CoinGeckoExchangeRateResponse = {
    [K in Coins]?: {
        [C in Currencies]?: number;
    };
};

const axios = setupCache(axiosFactory.create());

export async function getExchangeRate({ coin, currency }: ExchangeRateConfig): Promise<ExchangeRateResponse> {
    try {
        const rate = await axios.get<CoinGeckoExchangeRateResponse>('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: coin,
                vs_currencies: currency,
            },
        });

        return {
            coin,
            currency,
            rate: rate.data[coin]?.[currency] ?? null,
        };
    } catch (e) {
        logger.error(`Error getting exchange rate for ${coin} to ${currency}: ${e}`);

        return {
            coin,
            currency,
            rate: null,
        };
    }
}
