import { AxiosInstance } from 'axios';

import CoinGecko from '../../../../../../src/blockchains/solana/providers/coingecko/CoinGecko';
import { Coins, Currencies } from '../../../../../../src/blockchains/solana/providers/coingecko/types';

describe(CoinGecko.name, () => {
    let coinGecko: CoinGecko;
    const mockedAxios = {
        get: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        coinGecko = new CoinGecko(mockedAxios as unknown as AxiosInstance);
    });

    it('should return exchange rate when API call is successful', async () => {
        const mockResponse = {
            data: {
                [Coins.SOL]: {
                    [Currencies.USD]: 100.5,
                },
            },
        };
        mockedAxios.get.mockResolvedValueOnce(mockResponse);

        const result = await coinGecko.getExchangeRate({
            coin: Coins.SOL,
            currency: Currencies.USD,
        });

        expect(mockedAxios.get).toHaveBeenCalledWith('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: Coins.SOL,
                vs_currencies: Currencies.USD,
            },
        });

        expect(result).toEqual({
            coin: Coins.SOL,
            currency: Currencies.USD,
            rate: 100.5,
        });
    });

    it('should return null rate when API response is missing data', async () => {
        const mockResponse = {};
        mockedAxios.get.mockResolvedValueOnce(mockResponse);

        const result = await coinGecko.getExchangeRate({
            coin: Coins.SOL,
            currency: Currencies.USD,
        });

        expect(mockedAxios.get).toHaveBeenCalledWith('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: Coins.SOL,
                vs_currencies: Currencies.USD,
            },
        });

        expect(result).toEqual({
            coin: Coins.SOL,
            currency: Currencies.USD,
            rate: null,
        });
    });

    it('should return null rate when API call fails', async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

        const result = await coinGecko.getExchangeRate({
            coin: Coins.SOL,
            currency: Currencies.USD,
        });

        expect(mockedAxios.get).toHaveBeenCalledWith('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: Coins.SOL,
                vs_currencies: Currencies.USD,
            },
        });

        expect(result).toEqual({
            coin: Coins.SOL,
            currency: Currencies.USD,
            rate: null,
        });
    });
});
