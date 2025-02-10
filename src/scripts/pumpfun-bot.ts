import fs from 'fs';

import dotenv from 'dotenv';
import { Logger } from 'winston';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    NewPumpFunTokenData,
    PumpfunInitialCoinData,
    PumpfunTokenBcStats,
} from '../blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '../blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { TokenHolder, TransactionMode, WalletInfo } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { lamportsToSol, solToLamports } from '../blockchains/utils/amount';
import { logger } from '../logger';
import { sleep } from '../utils/functions';
import { ensureDataFolder } from '../utils/storage';

dotenv.config();

type BuyPosition = {
    timestamp: number;
    amountRaw: number;
    netTransferredLamports: number;
    pumpInSol: number;
    priceInLamports: number;
    marketCap: number;
};

type HistoryEntry = {
    timestamp: number;
    price: number;
    marketCap: number;
    bondingCurveProgress: number;
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
};

type HandleTokenBoughtResponse = {
    buyPosition: BuyPosition;
    sellPosition?: {
        grossReceivedLamports: number;
        netReceivedLamports: number; // this can be negative if the fees are higher than the gross received
        pumpMinLamportsOutput: number;
        priceInLamports: number;
        marketCap: number;
        reason: string;
    };
    history: HistoryEntry[];
};

type HandleTokenExitResponse = {
    exitCode: 'NO_PUMP' | 'DUMPED';
    exitReason: string;
    history: HistoryEntry[];
};

type HandleNewTokenResponse = HandleTokenBoughtResponse | HandleTokenExitResponse;

(async () => {
    await start();
})();

const SIMULATE = true;
const BUY_MONITOR_WAIT_PERIOD_MS = 1000;
const SELL_MONITOR_WAIT_PERIOD_MS = 250;

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

    logger.info(`Started with balance ${lamportsToSol(await solanaAdapter.getBalance(walletInfo.address))} SOL`);

    await listen();

    async function listen() {
        const maxTokensToProcessInParallel: number | null = 1;
        let processed = 0;
        let lamportsBalance = await solanaAdapter.getBalance(walletInfo.address);

        await pumpfun.listenForPumpFunTokens(async tokenData => {
            if (maxTokensToProcessInParallel && processed >= maxTokensToProcessInParallel) {
                logger.info(
                    `Returning and stopping listener as we processed already maximum specified tokens ${maxTokensToProcessInParallel}`,
                );
                pumpfun.stopListeningToNewTokens();
                return;
            }
            processed++;

            try {
                logger.info(
                    'Handling newly created token: %s, %s',
                    tokenData.name,
                    formPumpfunTokenUrl(tokenData.mint),
                );

                const handleRes = await handlePumpToken(
                    pumpfun,
                    solanaAdapter,
                    logger.child({
                        contextMap: {
                            tokenMint: tokenData.mint,
                        },
                    }),
                    {
                        tokenData: tokenData,
                        walletInfo: walletInfo,
                        simulate: SIMULATE,
                    },
                );
                await fs.writeFileSync(
                    ensureDataFolder(`pumpfun-stats/${tokenData.mint}.json`),
                    JSON.stringify(
                        {
                            mint: tokenData.mint,
                            name: tokenData.name,
                            url: formPumpfunTokenUrl(tokenData.mint),
                            ...handleRes,
                        },
                        null,
                        2,
                    ),
                );

                if (SIMULATE) {
                    if ((handleRes as HandleTokenBoughtResponse).buyPosition) {
                        const t = handleRes as HandleTokenBoughtResponse;
                        if (t.sellPosition) {
                            lamportsBalance +=
                                t.sellPosition.netReceivedLamports + t.buyPosition.netTransferredLamports;
                            logger.info(`Simulated new balance: ${lamportsToSol(lamportsBalance)}`);
                        }
                    }
                }
            } catch (e) {
                logger.error('Failed handling pump token %s', tokenData.mint);
                logger.error(e);
            }

            if (maxTokensToProcessInParallel && processed === maxTokensToProcessInParallel) {
                logger.info(
                    `Processed ${processed} = maxTokensToProcessInParallel ${maxTokensToProcessInParallel} and will start to listen again`,
                );
                return await listen();
            }
        });
    }
}

/**
 * This function will handle a single buy and sell for the specified  pump token
 * or end without buying if no profitability is found
 */
async function handlePumpToken(
    pumpfun: Pumpfun,
    solanaAdapter: SolanaAdapter,
    logger: Logger,
    {
        tokenData,
        walletInfo,
        simulate,
    }: {
        tokenData: NewPumpFunTokenData;
        walletInfo: WalletInfo;
        simulate: boolean;
    },
): Promise<HandleNewTokenResponse> {
    const tokenMint = tokenData.mint;

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
    let initialMarketCap = -1;

    let buy = false;
    let sell:
        | {
              reason: string;
          }
        | undefined;
    const history: HistoryEntry[] = [];
    let buyPosition: BuyPosition | undefined;

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
            bondingCurveProgress: bondingCurveProgress,
            holdersCount: holdersCounts,
            devHoldingPercentage: devHoldingPercentage,
            topTenHoldingPercentage: topTenHoldingPercentage,
        });

        if (initialMarketCap === -1) {
            initialMarketCap = marketCap;
        }

        const mcDiffFromInitialPercentage = ((marketCap - initialMarketCap) / initialMarketCap) * 100;

        logger.info('marketCap=%s, price=%s, bondingCurveProgress=%s%%', marketCap, price, bondingCurveProgress);
        logger.info(
            'total holders=%d, top ten holding %s%%, dev holding %s%%',
            holdersCounts,
            topTenHoldingPercentage,
            devHoldingPercentage,
        );
        logger.info('Current vs initial market cap % difference: %s%%', mcDiffFromInitialPercentage);

        if (!buyPosition && holdersCounts >= 10 && bondingCurveProgress >= 20) {
            logger.info('We set buy=true because the conditions are met');
            buy = true;
        }

        if (mcDiffFromInitialPercentage < -6) {
            if (buyPosition) {
                logger.info('The token is probably dumped and we will sell at loss, sell=true');
                sell = {
                    reason: 'DUMPED',
                };
            } else {
                const reason = `Stopped monitoring token ${tokenMint} because it was probably dumped and current market cap is less than the initial one`;
                logger.info(reason);

                return {
                    exitCode: 'DUMPED',
                    exitReason: reason,
                    history: history,
                };
            }
        }

        if (!buyPosition && elapsedMonitoring >= maxWaitMs) {
            const reason = `Stopped monitoring token ${tokenMint}. We waited ${
                elapsedMonitoring / 1000
            } seconds and did not pump`;
            logger.info(reason);

            return {
                exitCode: 'NO_PUMP',
                exitReason: reason,
                history: history,
            };
        }

        if (buyPosition) {
            if (price * buyPosition.amountRaw - Math.abs(buyPosition.netTransferredLamports) >= solToLamports(0.025)) {
                sell = {
                    reason: 'AT_PROFIT',
                };
            }
        }

        // eslint-disable-next-line no-unreachable
        if (!buyPosition && buy) {
            // TODO calculate dynamically based on the situation
            const inSol = 0.2;
            const buyRes = await pumpfun.buy({
                transactionMode: simulate ? TransactionMode.Simulation : TransactionMode.Execution,
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
                netTransferredLamports: buyRes.txDetails.netTransferredLamports,
                pumpInSol: inSol,
                priceInLamports: price,
                marketCap: marketCap,
            };
            sleepIntervalMs = SELL_MONITOR_WAIT_PERIOD_MS;

            logger.info(
                'Bought successfully %s amountRaw for %s sol. txDetails %o',
                buyRes!.boughtAmountRaw,
                inSol,
                buyRes.txDetails,
            );
        }

        if (sell && buyPosition) {
            const sellRes = await pumpfun.sell({
                transactionMode: simulate ? TransactionMode.Simulation : TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: tokenMint,
                tokenBondingCurve: initialCoinData.bondingCurve,
                tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                slippageDecimal: 0.5,
                tokenBalance: buyPosition.amountRaw,
                priorityFeeInSol: 0.002,
            });
            logger.info(
                'We sold successfully %s amountRaw with reason %s and received net %s sol. txDetails=%o',
                sellRes.soldRawAmount,
                sell.reason,
                lamportsToSol(sellRes.txDetails.netTransferredLamports),
                sellRes.txDetails,
            );

            return {
                buyPosition: buyPosition,
                sellPosition: {
                    grossReceivedLamports: sellRes.txDetails.grossTransferredLamports,
                    netReceivedLamports: sellRes.txDetails.netTransferredLamports,
                    pumpMinLamportsOutput: sellRes.minLamportsOutput,
                    priceInLamports: price,
                    marketCap: marketCap,
                    reason: sell.reason,
                },
                history: history,
            };
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
