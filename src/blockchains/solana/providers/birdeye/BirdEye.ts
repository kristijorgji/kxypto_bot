import axios, { AxiosRequestConfig } from 'axios';

type DataResponse<T> = {
    data: T;
};

type Price = {
    value: number;
    updateUnixTime: number;
    updateHumanTime: string;
    priceChange24h: number;
};

export default class BirdEye {
    private readonly reqConfig: AxiosRequestConfig;

    constructor(
        private readonly config: {
            url: string;
            apiKey: string;
        },
    ) {
        this.reqConfig = {
            headers: {
                'X-API-KEY': this.config.apiKey,
            },
        } as AxiosRequestConfig;
    }

    async getPrice(tokenAddress: string): Promise<Price> {
        return (
            await axios.get<DataResponse<Price>>(`${this.config.url}/defi/price`, {
                ...this.reqConfig,
                params: {
                    address: tokenAddress,
                },
            })
        ).data.data;
    }

    async getSupply(tokenAddress: string) {
        return axios.get(`${this.config.url}/defi/token_overview`, {
            ...this.reqConfig,
            params: {
                address: tokenAddress,
            },
        });
    }

    async getTrades(tokenAddress: string) {
        return axios.get(`${this.config.url}/defi/txs/token`, {
            ...this.reqConfig,
            params: {
                address: tokenAddress,
                timeframe: '1h',
                tx_type: 'swap',
                limit: 50,
                sort_type: 'desc',
            },
        });
    }
}
