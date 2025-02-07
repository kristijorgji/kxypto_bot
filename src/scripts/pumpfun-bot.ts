import dotenv from 'dotenv';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    NewPumpFunTokenData,
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunTokenBcStats,
} from '../blockchains/solana/dex/pumpfun/types';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { TokenHolder, TransactionMode, WalletInfo } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { logger } from '../logger';
import { sleep } from '../utils/functions';

dotenv.config();

(async () => {
    await start();
})();

const BUY_MONITOR_WAIT_PERIOD_MS = 2000;
const SELL_MONITOR_WAIT_PERIOD_MS = 500;

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

    const maxTokensToProcess = 1;
    let processed = 0;

    await pumpfun.listenForPumpFunTokens(async tokenData => {
        if (processed >= maxTokensToProcess) {
            logger.info(
                `Returning and stopping listener as we processed already maximum specified tokens ${maxTokensToProcess}`,
            );
            pumpfun.stopListeningToNewTokens();
            return;
        }
        processed++;

        await handleNewToken(pumpfun, solanaAdapter, {
            tokenData: tokenData,
            walletInfo: walletInfo,
        });
    });
}

async function handleNewToken(
    pumpfun: Pumpfun,
    solanaAdapter: SolanaAdapter,
    {
        tokenData,
        walletInfo,
    }: {
        tokenData: NewPumpFunTokenData;
        walletInfo: WalletInfo;
    },
) {
    const tokenMint = tokenData.mint;

    logger.info('Handling newly created token: %s, %s', tokenData.name, `https://pump.fun/coin/${tokenMint}`);

    let initialCoinData: PumpfunInitialCoinData;
    try {
        initialCoinData = pumpCoinDataToInitialCoinData(
            await pumpfun.getCoinDataWithRetries(tokenMint, {
                maxRetries: 4,
                sleepMs: 250,
            }),
        );
    } catch (e) {
        logger.warn('Failed to fetch full token initial data, will use our own fallback');
        initialCoinData = await pumpfun.getInitialCoinBaseData(tokenMint);
    }

    let sleepIntervalMs = BUY_MONITOR_WAIT_PERIOD_MS; // sleep interval between fetching new stats, price, holders etc. We can keep it higher before buying to save RPC calls and reduce when want to sell and monitor faster
    const maxWaitMs = 3 * 60 * 1000; // don't waste time on this token anymore if there is no increase until this time is reached
    const startTimestamp = Date.now();
    let initialPrice = -1;
    let initialMarketCap = -1;
    let buyPosition:
        | {
              timestamp: number;
              amountRaw: number;
              priceInSol: number;
          }
        | undefined;

    let buyRes: PumpfunBuyResponse | undefined;
    let buy = false;
    let sell = false;
    const history: {
        timestamp: number;
        price: number;
        marketCap: number;
        holdersCount: number;
    }[] = [];

    while (true) {
        // @ts-ignore
        const [tokenHolders, { marketCap, price, bondingCurveProgress }]: [TokenHolder[], PumpfunTokenBcStats] =
            await Promise.all([
                solanaAdapter.getTokenHolders({
                    tokenMint: tokenMint,
                }),
                pumpfun.getTokenBondingCurveStats(tokenData.bondingCurve),
            ]);

        const elapsedMonitoring = Date.now() - startTimestamp;

        const { holdersCounts, devHoldingPercentage, topTenHoldingPercentage } = await calculateHoldersStats({
            tokenHolders: tokenHolders,
            creator: initialCoinData.creator,
        });

        history.push({
            timestamp: Date.now(),
            price: price,
            marketCap: marketCap,
            holdersCount: holdersCounts,
        });

        if (initialPrice === -1) {
            initialPrice = price;
        }
        if (initialMarketCap === -1) {
            initialMarketCap = marketCap;
        }

        const priceDiffFromInitialPercentage = ((price - initialPrice) / initialPrice) * 100;
        const percentageDiffInMarketCap = ((marketCap - initialMarketCap) / initialMarketCap) * 100;

        logger.info(
            'There are %d total holders, top ten holding %s%%, dev holding %s%%',
            holdersCounts,
            topTenHoldingPercentage,
            devHoldingPercentage,
        );
        logger.info('Price diff %% since start %s in sol now %s', priceDiffFromInitialPercentage, price);
        logger.info(
            'Current marketCap=%s, price=%s, bondingCurveProgress=%s%%',
            marketCap,
            price,
            bondingCurveProgress,
        );
        logger.info('Current vs initial market cap % difference: %s%%', percentageDiffInMarketCap);

        if (!buyPosition && holdersCounts > 10) {
            buy = true;
        }

        if (!buyPosition && elapsedMonitoring >= maxWaitMs) {
            logger.info(
                'Stopped monitoring token %s. We waited %s seconds and did not pump',
                tokenMint,
                elapsedMonitoring,
            );

            return;
        }

        if (buyPosition) {
            if (price - buyPosition.priceInSol > 0.07) {
                sell = true;
            }
        }

        // eslint-disable-next-line no-unreachable
        if (buy) {
            const inSol = 0.005;
            buyRes = await pumpfun.buy({
                transactionMode: TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: tokenMint,
                tokenBondingCurve: initialCoinData.bondingCurve,
                tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                solIn: inSol,
                slippageDecimal: 0.5,
                priorityFeeInSol: 0.002,
            });
            buyPosition = {
                timestamp: Date.now(),
                amountRaw: buyRes.boughtAmountRaw,
                priceInSol: inSol,
            };
            sleepIntervalMs = SELL_MONITOR_WAIT_PERIOD_MS;

            logger.info('Bought successfully %s amountRaw for %s sol', buyRes!.boughtAmountRaw, inSol);
        }

        if (sell && buyPosition) {
            await pumpfun.sell({
                transactionMode: TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: tokenMint,
                tokenBondingCurve: initialCoinData.bondingCurve,
                tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                slippageDecimal: 0.5,
                tokenBalance: buyPosition.amountRaw,
                priorityFeeInSol: 0.002,
            });
            logger.info('We sold successfully');

            return;
        }

        await sleep(sleepIntervalMs);
    }
}

async function calculateHoldersStats({
    tokenHolders,
    creator,
}: {
    tokenHolders: TokenHolder[];
    creator?: string;
}): Promise<{
    holdersCounts: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
}> {
    tokenHolders.sort((a, b) => b.amount - a.amount);
    let devHolding = -1;

    const holdersCounts = tokenHolders.length;
    let topTenHolding = 0;
    let allHolding = 0;
    for (let i = 0; i < tokenHolders.length; i++) {
        const tokenHolder = tokenHolders[i];
        if (tokenHolder.address === creator) {
            devHolding = tokenHolder.amount;
        }

        if (i < 10) {
            topTenHolding += tokenHolder.amount;
        }
        allHolding += tokenHolder.amount;
    }

    const topTenHoldingPercentage = (topTenHolding / allHolding) * 100;
    const devHoldingPercentage = devHolding === -1 ? -1 : (devHolding / allHolding) * 100;

    return {
        holdersCounts,
        devHoldingPercentage,
        topTenHoldingPercentage,
    };
}
