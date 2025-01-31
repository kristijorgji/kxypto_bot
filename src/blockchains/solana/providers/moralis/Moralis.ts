import axios, { AxiosRequestConfig } from 'axios';

type CursorPaginatedResponse<T> = {
    cursor?: string | null;
    page: number;
    pageSize: number;
    result: T[];
};

type TokenType = 'token0' | 'token1';

type ExchangeName = 'Meteora DLMM' | 'Orca Whirlpool' | 'Raydium CLMM' | 'Raydium CPMM' | string;

type BoughtSold = {
    address: string;
    name: string;
    symbol: string;
    logo: string | null;
    amount: string;
    usdPrice: number;
    usdAmount: number;
    tokenType: TokenType;
};

type TransactionType = 'buy' | 'sell';

type SwapSubCategory = 'accumulation' | 'newPosition' | 'partialSell' | 'sellAll';

type Swap = {
    transactionHash: string;
    transactionType: TransactionType;
    transactionIndex: number;
    subCategory: SwapSubCategory;
    blockTimestamp: string; // ex: '2025-01-31T12:17:23.000Z'
    blockNumber: number;
    walletAddress: string;
    pairAddress: string;
    pairLabel: string; // ex: 'TRUMP/SOL';
    exchangeAddress: string;
    exchangeName: ExchangeName;
    exchangeLogo: string;
    baseToken: string;
    quoteToken: string;
    bought: BoughtSold;
    sold: BoughtSold;
    baseQuotePrice: string;
    totalValueUsd: number;
};

type PairToken = {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenLogo: string | null;
    tokenDecimals: string;
    pairTokenType: TokenType;
    liquidityUsd: number;
};

type Pair = {
    exchangeAddress: string;
    exchangeName: ExchangeName;
    exchangeLogo: string;
    pairAddress: string;
    pairLabel: string; // ex TRUMP/USDC;
    usdPrice: string;
    usdPrice24hrPercentChange: string;
    usdPrice24hrUsdChange: string;
    volume24hrNative: string;
    volume24hrUsd: string;
    liquidityUsd: string;
    baseToken: string;
    quoteToken: string;
    inactivePair: false;
    pair: [PairToken, PairToken];
};

type StatsPerInterval = {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
};

type PairStats = {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenLogo: string;
    pairCreated: null;
    pairLabel: string; // ex 'TRUMP/USDC';
    pairAddress: string;
    exchange: ExchangeName;
    exchangeAddress: string;
    exchangeLogo: string;
    exchangeUrl: null;
    currentUsdPrice: string;
    currentNativePrice: string;
    totalLiquidityUsd: string;
    pricePercentChange: StatsPerInterval;
    liquidityPercentChange: StatsPerInterval;
    buys: StatsPerInterval;
    sells: StatsPerInterval;
    totalVolume: StatsPerInterval;
    buyVolume: StatsPerInterval;
    sellVolume: StatsPerInterval;
    buyers: StatsPerInterval;
    sellers: StatsPerInterval;
};

type GetTokenPairsResponse = Omit<CursorPaginatedResponse<Pair>, 'result'> & { pairs: Pair[] };

type TokenBasicInfo = {
    address: string;
    name: string;
    symbol: string;
    logo: string | null;
    decimals: string;
};

type GetPairTradesResponse = {
    cursor: string;
    page: number;
    pageSize: number;
    exchangeLogo: string;
    exchangeName: ExchangeName;
    exchangeAddress: string;
    pairAddress: string;
    pairLabel: string; // ex 'TRUMP/USDC'
    baseToken: TokenBasicInfo;
    quoteToken: TokenBasicInfo;
    result: {
        transactionHash: string;
        transactionType: TransactionType;
        transactionIndex: number;
        subCategory: SwapSubCategory;
        blockTimestamp: string; // ex '2025-01-31T17:49:26.000Z'
        blockNumber: number;
        walletAddress: string;
        baseTokenAmount: string;
        quoteTokenAmount: string;
        baseTokenPriceUsd: number;
        quoteTokenPriceUsd: number;
        baseQuotePrice: string;
        totalValueUsd: number;
    }[];
};

export default class Moralis {
    private readonly reqConfig: AxiosRequestConfig;

    constructor(
        private readonly config: {
            apiKey: string;
        },
    ) {
        this.reqConfig = {
            headers: {
                'X-API-KEY': this.config.apiKey,
                accept: 'application/json',
            },
        } as AxiosRequestConfig;
    }

    async getTokenPairs({
        tokenAddress,
        cursor,
    }: {
        tokenAddress: string;
        cursor?: string | null;
    }): Promise<GetTokenPairsResponse> {
        return (
            await axios.get<GetTokenPairsResponse>(
                `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/pairs`,
                {
                    ...this.reqConfig,
                    params: {
                        limit: 50,
                        ...(cursor
                            ? {
                                  cursor: cursor,
                              }
                            : {}),
                    },
                },
            )
        ).data as GetTokenPairsResponse;
    }

    async getTokenPairStats(pairAddress: string): Promise<PairStats> {
        return (
            await axios.get<PairStats>(
                `https://solana-gateway.moralis.io/token/mainnet/pairs/${pairAddress}/stats`,
                this.reqConfig,
            )
        ).data as PairStats;
    }

    async getTokenTrades({
        tokenAddress,
        cursor,
    }: {
        tokenAddress: string;
        cursor?: string | null;
    }): Promise<CursorPaginatedResponse<Swap>> {
        return (
            await axios.get<CursorPaginatedResponse<Swap>>(
                `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/swaps`,
                {
                    ...this.reqConfig,
                    params: {
                        order: 'DESC',
                        limit: 50,
                        ...(cursor
                            ? {
                                  cursor: cursor,
                              }
                            : {}),
                    },
                },
            )
        ).data as CursorPaginatedResponse<Swap>;
    }

    async getPairTrades({
        pairAddress,
        cursor,
    }: {
        pairAddress: string;
        cursor?: string | null;
    }): Promise<GetPairTradesResponse> {
        return (
            await axios.get<GetPairTradesResponse>(
                `https://solana-gateway.moralis.io/token/mainnet/pairs/${pairAddress}/swaps`,
                {
                    ...this.reqConfig,
                    params: {
                        order: 'DESC',
                        ...(cursor
                            ? {
                                  cursor: cursor,
                              }
                            : {}),
                    },
                },
            )
        ).data as GetPairTradesResponse;
    }
}
