import dotenv from 'dotenv';
import CircuitBreaker from 'opossum';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    PumpFunCoinData,
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunTokenStats,
} from '../blockchains/solana/dex/pumpfun/types';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { TokenHolder, TransactionMode } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { CircuitBreakerError } from '../core/types';
import { logger } from '../logger';
import { sleep } from '../utils/functions';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const solanaAdapter = await new SolanaAdapter({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    const maxTokensToSnipe = 1;
    let snipped = 0;

    await pumpfun.listenForPumpFunTokens(async tokenData => {
        if (snipped >= maxTokensToSnipe) {
            logger.info(
                `Returning and stopping listener as we snipped already maximum specified tokens ${maxTokensToSnipe}`,
            );
            pumpfun.stopListeningToNewTokens();
            return;
        }
        snipped++;

        const tokenMint = tokenData.mint;

        logger.info('New token was created: %s, %s', tokenData.name, `https://pump.fun/coin/${tokenMint}`);

        let initialCoinData: PumpfunInitialCoinData;
        try {
            initialCoinData = coinDataToInitialCoinData(
                await pumpfun.getCoinDataWithRetries(tokenMint, {
                    maxRetries: 3,
                    sleepMs: 200,
                }),
            );
        } catch (e) {
            logger.warn('Failed to fetch full token initial data, will use our own fallback');
            initialCoinData = await pumpfun.getInitialCoinBaseData(tokenMint);
        }

        let initialPrice = -1;
        let initialMarketCap = -1;
        let devHolding = 0;

        let buyRes: PumpfunBuyResponse | undefined;
        const buy = false;
        const sell = false;

        try {
            while (true) {
                // @ts-ignore
                const responses: [PumpFunCoinData | null, TokenHolder[], PumpfunTokenStats] = await Promise.all([
                    tryToFetchCoinData(tokenMint),
                    solanaAdapter.getTokenHolders({
                        tokenMint: tokenMint,
                    }),
                    pumpfun.getTokenStats(tokenData.bondingCurve),
                ]);

                const latestCoinData = responses[0];

                const tokenHolders: TokenHolder[] = responses[1];
                tokenHolders.sort((a, b) => b.amount - a.amount);

                const holdersCounts = tokenHolders.length;
                let topTenHolding = 0;
                let allHolding = 0;
                for (let i = 0; i < tokenHolders.length; i++) {
                    const tokenHolder = tokenHolders[i];
                    if (tokenHolder.address === initialCoinData.creator) {
                        devHolding = tokenHolder.amount;
                    }

                    if (i < 10) {
                        topTenHolding += tokenHolder.amount;
                    }
                    allHolding += tokenHolder.amount;
                }
                const topTenHoldingPercentage = (topTenHolding / allHolding) * 100;
                logger.info('There are %d total holders, top ten holding %s%%', holdersCounts, topTenHoldingPercentage);

                if (initialCoinData.creator) {
                    const devHoldingPercentage = (devHolding / allHolding) * 100;
                    logger.info('Dev holds %s%%', devHoldingPercentage);
                }

                const tokenStats = responses[2];
                if (initialPrice === -1) {
                    initialPrice = tokenStats.price;
                }
                if (initialMarketCap === -1) {
                    initialMarketCap = tokenStats.marketCap;
                }

                const priceDiffFromInitialPercentage = ((tokenStats.price - initialPrice) / initialPrice) * 100;
                logger.info(
                    'Price diff %% since start %s in sol now %s',
                    priceDiffFromInitialPercentage,
                    tokenStats.price,
                );
                logger.info(
                    'Current marketCap=%s, price=%s, bondingCurveProgress=%s%%',
                    tokenStats.marketCap,
                    tokenStats.price,
                    tokenStats.bondingCurveProgress,
                );

                if (latestCoinData) {
                    const percentageDiffInMarketCap =
                        ((latestCoinData.market_cap - initialMarketCap) / initialMarketCap) * 100;
                    logger.info('Current vs initial market cap % difference: %s%%', percentageDiffInMarketCap);
                }

                await sleep(1000);
            }

            // eslint-disable-next-line no-unreachable
            if (buy) {
                const inSol = 0.005;
                buyRes = await pumpfun.buy({
                    transactionMode: TransactionMode.Execution,
                    payerPrivateKey: walletInfo.privateKey,
                    tokenMint: tokenMint,
                    solIn: inSol,
                    slippageDecimal: 0.5,
                    priorityFeeInSol: 0.002,
                });

                logger.info('Bought successfully %s amountRaw for %s sol', buyRes!.boughtAmountRaw, inSol);
            }

            if (sell && buyRes) {
                await pumpfun.sell({
                    transactionMode: TransactionMode.Execution,
                    payerPrivateKey: walletInfo.privateKey,
                    tokenMint: tokenMint,
                    slippageDecimal: 0.5,
                    tokenBalance: buyRes!.boughtAmountRaw,
                    priorityFeeInSol: 0.002,
                });
            }
        } catch (e) {
            console.error(e);
        }
    });

    /**
     * The hacky frontend api of pumpfun is faulty and fails often with 500
     * @param tokenMint
     */
    async function tryToFetchCoinData(tokenMint: string): Promise<PumpFunCoinData | null> {
        const maxTimeMs = 700;
        try {
            return await new CircuitBreaker(() => pumpfun.getCoinData(tokenMint), {
                timeout: maxTimeMs,
            }).fire();
        } catch (err) {
            if (CircuitBreaker.isOurError(err as Error)) {
                if ((err as CircuitBreakerError).code === 'ETIMEDOUT') {
                    logger.warn(`tryToFetchCoinData circuit breaker timeout at ${maxTimeMs}ms`);
                } else {
                    throw err;
                }
            }

            return null;
        }
    }
}

function coinDataToInitialCoinData(coinData: PumpFunCoinData): PumpfunInitialCoinData {
    return {
        mint: coinData.mint,
        creator: coinData.creator,
        createdTimestamp: coinData.created_timestamp,
        bondingCurve: coinData.bonding_curve,
        associatedBondingCurve: coinData.associated_bonding_curve,
        name: coinData.name,
        symbol: coinData.symbol,
        description: coinData.description,
        image: coinData.image_uri,
        twitter: coinData.twitter,
        telegram: coinData.telegram,
        website: coinData.website,
    };
}
