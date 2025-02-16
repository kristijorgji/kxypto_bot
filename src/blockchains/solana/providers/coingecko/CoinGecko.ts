import { AxiosInstance } from 'axios';

import { CoinGeckoExchangeRateResponse, ExchangeRateConfig, ExchangeRateResponse } from './types';
import { logger } from '../../../../logger';

export default class CoinGecko {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly axios: AxiosInstance) {}

    async getExchangeRate({ coin, currency }: ExchangeRateConfig): Promise<ExchangeRateResponse> {
        try {
            const rate = await this.axios.get<CoinGeckoExchangeRateResponse>(
                'https://api.coingecko.com/api/v3/simple/price',
                {
                    params: {
                        ids: coin,
                        vs_currencies: currency,
                    },
                },
            );

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
}
