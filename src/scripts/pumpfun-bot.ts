import dotenv from 'dotenv';
import CircuitBreaker from 'opossum';

import Pumpfun, { PumpFunCoinData } from '../blockchains/solana/dex/pumpfun/Pumpfun';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { TokenHolder } from '../blockchains/solana/types';
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

    // const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
    //     provider: SolanaWalletProviders.TrustWallet,
    // });

    // const m = await pumpfun.bondingCurveProgress({
    //     mintAddress: '8ka7UbDmpaL91iAPUpVtw4mNFDNCEjdLvQ32hshfpump',
    //     userPrivateKey: walletInfo.privateKey,
    // });
    // return;

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

        const initialCoinData = await pumpfun.getCoinDataWithRetries(tokenMint, {
            maxRetries: 3,
            sleepMs: 250,
        });
        let initialPrice = -1;
        const initialMarketCap = initialCoinData.market_cap;
        let devHolding = 0;

        try {
            while (true) {
                // @ts-ignore
                const responses: [PumpFunCoinData | null, TokenHolder[], number | null] = await Promise.all([
                    tryToFetchCoinData(tokenMint),
                    solanaAdapter.getTokenHolders({
                        tokenMint: tokenMint,
                    }),
                    pumpfun.getEstTokenPriceInSol(tokenData.bondingCurve),
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

                const devHoldingPercentage = (devHolding / allHolding) * 100;
                logger.info('Dev holds %s%%', devHoldingPercentage);

                const priceInSol = responses[2];
                if (initialPrice === -1 && priceInSol) {
                    initialPrice = priceInSol;
                    const priceDiffFromInitialPercentage = ((priceInSol - initialPrice) / initialPrice) * 100;
                    logger.info(
                        'Price diff %% since start %s in sol now %s',
                        priceDiffFromInitialPercentage,
                        priceInSol,
                    );
                } else {
                    logger.info('Cannot calculate price yet as bounding curve account is not setup properly');
                }

                if (latestCoinData) {
                    const percentageDiffInMarketCap =
                        ((latestCoinData.market_cap - initialMarketCap) / initialMarketCap) * 100;
                    logger.info('Current vs initial market cap % difference: %s%%', percentageDiffInMarketCap);
                }

                await sleep(1000);
            }

            // const inSol = 0.005;
            // const buyRes = await pumpfun.buy({
            //     transactionMode: TransactionMode.Execution,
            //     payerPrivateKey: walletInfo.privateKey,
            //     tokenMint: tokenMint,
            //     solIn: inSol,
            //     slippageDecimal: 0.5,
            //     priorityFeeInSol: 0.002,
            // });
            //
            // logger.info('Bought successfully %s amountRaw for %s sol', buyRes.boughtAmountRaw, inSol);
            //
            // logger.info('Sleeping 5s then selling');
            // await sleep(5000);
            //
            // await pumpfun.sell({
            //     transactionMode: TransactionMode.Execution,
            //     payerPrivateKey: walletInfo.privateKey,
            //     tokenMint: tokenMint,
            //     slippageDecimal: 0.5,
            //     tokenBalance: buyRes.boughtAmountRaw,
            //     priorityFeeInSol: 0.002,
            // });
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
