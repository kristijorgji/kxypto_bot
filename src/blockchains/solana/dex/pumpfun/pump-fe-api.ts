import axios, { AxiosError } from 'axios';
import { Logger } from 'winston';

import { PumpFunCoinData } from '@src/blockchains/solana/dex/pumpfun/types';
import { RetryConfig } from '@src/core/types';
import { randomInt } from '@src/utils/data/data';
import { sleep } from '@src/utils/functions';

/**
 * A helper function to retry as needed because this frontend api is
 * buggy and fails with 500 status code often
 * Use only for the initial data and optional data, can't rely on for realtime info
 */
export async function getPumpCoinDataWithRetriesFromFrontendApi(
    logger: Logger,
    tokenMint: string,
    { maxRetries = 3, sleepMs = 0 }: RetryConfig,
): Promise<PumpFunCoinData> {
    let coinData: PumpFunCoinData | undefined;
    let retries = 0;
    let error: Error | AxiosError | undefined;

    do {
        try {
            coinData = await getPumpCoinDataFromFrontendApi(tokenMint);
        } catch (e) {
            error = e as Error | AxiosError;
            if (e instanceof AxiosError && e.response?.status === 429) {
                const retryInMs = randomInt(5000, 20000);
                logger.info(
                    'failed to fetch coin data on retry %d, we got back response 429, will retry in %ds',
                    retries,
                    retryInMs / 1000,
                );
                await sleep(retryInMs);
                retries--;
            } else {
                sleepMs = typeof sleepMs === 'function' ? sleepMs(retries + 1) : sleepMs;
                logger.error(
                    `failed to fetch coin data on retry ${retries}, error: %s. Will retry after sleeping ${sleepMs}`,
                    (e as Error).message,
                );
                if (sleepMs > 0) {
                    await sleep(sleepMs);
                }
            }
        }
    } while (!coinData && retries++ < maxRetries);

    if (!coinData) {
        throw new Error(
            `Could not fetch coinData for mint ${tokenMint} after ${retries - 1} retries, err: ${error?.message}`,
        );
    }

    return coinData;
}

async function getPumpCoinDataFromFrontendApi(tokenMint: string): Promise<PumpFunCoinData> {
    const url = `https://frontend-api-v3.pump.fun/coins/${tokenMint}`;
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            Referer: 'https://www.pump.fun/',
            Origin: 'https://www.pump.fun',
            Connection: 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'If-None-Match': 'W/"43a-tWaCcS4XujSi30IFlxDCJYxkMKg"',
        },
    });

    if (response.status === 200) {
        return response.data;
    }

    throw new Error(`Error fetching coinData ${response.status}`);
}
