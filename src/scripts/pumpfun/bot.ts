import fs from 'fs';

import dotenv from 'dotenv';
/* eslint-disable import/first */
dotenv.config();
import { Logger } from 'winston';

import { measureExecutionTime, startApm } from '../../apm/apm';
import { SolanaWalletProviders } from '../../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    NewPumpFunTokenData,
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunSellResponse,
    PumpfunTokenBcStats,
} from '../../blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '../../blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../../blockchains/solana/SolanaAdapter';
import { TokenHolder, TransactionMode, WalletInfo } from '../../blockchains/solana/types';
import { solanaConnection } from '../../blockchains/solana/utils/connection';
import solanaMnemonicToKeypair from '../../blockchains/solana/utils/solanaMnemonicToKeypair';
import { lamportsToSol } from '../../blockchains/utils/amount';
import { logger } from '../../logger';
import TakeProfitPercentage from '../../trading/orders/TakeProfitPercentage';
import TrailingStopLoss from '../../trading/orders/TrailingStopLoss';
import TrailingTakeProfit from '../../trading/orders/TrailingTakeProfit';
import UniqueRandomIntGenerator from '../../utils/data/UniqueRandomIntGenerator';
import { sleep } from '../../utils/functions';
import { ensureDataFolder } from '../../utils/storage';

type BuyPosition = {
    timestamp: number;
    amountRaw: number;
    grossReceivedLamports: number;
    netTransferredLamports: number;
    pumpInSol: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
    priceInLamports: number;
    marketCap: number;
};

type SellPosition = {
    timestamp: number;
    amountRaw: number;
    grossReceivedLamports: number;
    netReceivedLamports: number; // this can be negative if the fees are higher than the gross received
    pumpMinLamportsOutput: number;
    priceInLamports: number;
    marketCap: number;
    reason: string;
};

export type Trade = {
    buyPosition: BuyPosition;
    sellPositions: SellPosition[];
    netPnl: {
        inLamports: number;
        inSol: number;
    };
};

type HistoryEntry = {
    timestamp: number;
    price: number;
    marketCap: number;
    bondingCurveProgress: number;
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
    _afterResult: boolean; // if this history record was added after we exited or made a trade
};

type HandleTokenBoughtResponse = {
    trade: Trade;
    history: HistoryEntry[];
};

export type HandlePumpTokenExitCode = 'NO_PUMP' | 'DUMPED';

type HandleTokenExitResponse = {
    exitCode: HandlePumpTokenExitCode;
    exitReason: string;
    history: HistoryEntry[];
};

type HandleNewTokenResponse = HandleTokenBoughtResponse | HandleTokenExitResponse;

export type HandlePumpTokenReport = {
    schemaVersion: string; // our custom reporting schema version, used to filter the data in case we change content of the json report
    simulation: boolean;
    strategy: string; // a brief name of what we are trying to test, ex: take-profit-only
    mint: string;
    name: string;
    url: string;
} & HandleNewTokenResponse;

(async () => {
    await start();
})();

const SIMULATE = true;
const BUY_MONITOR_WAIT_PERIOD_MS = 500;
const SELL_MONITOR_WAIT_PERIOD_MS = 200;
const MONITOR_PERIOD_AFTER_RESULT_MS = 500;

async function start() {
    startApm();

    const uniqueRandomIntGenerator = new UniqueRandomIntGenerator();

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const solanaAdapter = await new SolanaAdapter(solanaConnection);

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    let balanceInLamports = await solanaAdapter.getBalance(walletInfo.address);
    logger.info(`Started with balance ${lamportsToSol(balanceInLamports)} SOL`);

    await listen();

    async function listen() {
        const identifier = uniqueRandomIntGenerator.next().toString();
        const maxTokensToProcessInParallel: number | null = 1;
        let processed = 0;

        logger.info(
            '[%s] started listen, processed=%s, maxTokensToProcessInParallel=%s',
            identifier,
            processed,
            maxTokensToProcessInParallel,
        );

        balanceInLamports = SIMULATE ? balanceInLamports : await solanaAdapter.getBalance(walletInfo.address);

        logger.info('[%s] balance %s SOL', identifier, lamportsToSol(balanceInLamports));

        await pumpfun.listenForPumpFunTokens(async tokenData => {
            logger.info(
                '[%s] Received newly created token: %s, %s',
                identifier,
                tokenData.name,
                formPumpfunTokenUrl(tokenData.mint),
            );

            if (maxTokensToProcessInParallel && processed >= maxTokensToProcessInParallel) {
                logger.info(
                    '[%s] Returning and stopping listener as we processed already maximum specified tokens %d',
                    identifier,
                    maxTokensToProcessInParallel,
                );
                pumpfun.stopListeningToNewTokens();
                return;
            }
            processed++;

            try {
                const handleRes = await handlePumpToken(
                    pumpfun,
                    solanaAdapter,
                    logger.child({
                        contextMap: {
                            listenerId: identifier,
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
                            schemaVersion: '1.00',
                            simulation: SIMULATE,
                            strategy: 'take_profit_04_s',
                            mint: tokenData.mint,
                            name: tokenData.name,
                            url: formPumpfunTokenUrl(tokenData.mint),
                            ...handleRes,
                        } as HandlePumpTokenReport,
                        null,
                        2,
                    ),
                );

                if (SIMULATE) {
                    if ((handleRes as HandleTokenBoughtResponse).trade) {
                        const t = handleRes as HandleTokenBoughtResponse;
                        balanceInLamports += t.trade.netPnl.inLamports;
                        logger.info('[%s] Simulated new balance: %s', identifier, lamportsToSol(balanceInLamports));
                    }
                }
            } catch (e) {
                logger.error('[%s] Failed handling pump token %s', identifier, tokenData.mint);
                logger.error(e);
            }

            if (maxTokensToProcessInParallel && processed === maxTokensToProcessInParallel) {
                logger.info(
                    '[%s] Will return and start listen function again. Processed %d = maxTokensToProcessInParallel %d.',
                    identifier,
                    processed,
                    maxTokensToProcessInParallel,
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
                maxRetries: 10,
                sleepMs: retryCount => (retryCount <= 5 ? 250 : 500),
            }),
        );
    } catch (e) {
        logger.warn('Failed to fetch full token initial data, will use our own fallback');
        initialCoinData = await pumpfun.getInitialCoinBaseData(tokenMint);
    }

    let sleepIntervalMs = BUY_MONITOR_WAIT_PERIOD_MS; // sleep interval between fetching new stats, price, holders etc. We can keep it higher before buying to save RPC calls and reduce when want to sell and monitor faster
    const maxWaitMs = 4 * 60 * 1e3; // don't waste time on this token anymore if there is no increase until this time is reached
    const startTimestamp = Date.now();
    const maxWaitMonitorAfterResultMs = 30 * 1e3;
    let intervalsMonitoredAfterResult = 0;
    let initialMarketCap = -1;

    let buy = false;
    let sell:
        | {
              reason: 'DUMPED' | 'TRAILING_STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_TAKE_PROFIT' | 'AT_HARDCODED_PROFIT';
          }
        | undefined;
    const history: HistoryEntry[] = [];
    let buyPosition: BuyPosition | undefined;
    let trailingStopLoss: TrailingStopLoss | undefined;
    let takeProfitPercentage: TakeProfitPercentage | undefined;
    let trailingTakeProfit: TrailingTakeProfit | undefined;
    let result: HandleNewTokenResponse | undefined;

    while (true) {
        // @ts-ignore
        const [tokenHolders, { marketCap, price, bondingCurveProgress }]: [TokenHolder[], PumpfunTokenBcStats] =
            await measureExecutionTime(
                () =>
                    Promise.all([
                        measureExecutionTime(
                            () =>
                                solanaAdapter.getTokenHolders({
                                    tokenMint: tokenMint,
                                }),
                            'solanaAdapter.getTokenHolders',
                        ),
                        measureExecutionTime(
                            () => pumpfun.getTokenBondingCurveStats(tokenData.bondingCurve),
                            'pumpfun.getTokenBondingCurveStats',
                        ),
                    ]),
                'getPumpTokenStats',
            );

        const elapsedMonitoringMs = Date.now() - startTimestamp;

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
            _afterResult: result !== undefined,
        });

        /**
         * We will continue to monitor for the specified period after are "done" with this particular token
         * either with exit without trade or with a trade done
         * These data will serve to further debug and backtest if our decision was correct or not
         */
        if (result) {
            if (intervalsMonitoredAfterResult === 0) {
                logger.info(
                    'We have the result already and are going to monitor %s seconds more',
                    maxWaitMonitorAfterResultMs / 1000,
                );
            }

            if (intervalsMonitoredAfterResult * MONITOR_PERIOD_AFTER_RESULT_MS >= maxWaitMonitorAfterResultMs) {
                return result;
            }

            intervalsMonitoredAfterResult++;
            await sleep(MONITOR_PERIOD_AFTER_RESULT_MS);
            continue;
        }

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

        if (!buyPosition && holdersCounts >= 15 && bondingCurveProgress >= 25 && devHoldingPercentage <= 15) {
            logger.info('We set buy=true because the conditions are met');
            buy = true;
        }

        if (
            mcDiffFromInitialPercentage < -6 ||
            (mcDiffFromInitialPercentage < -5 && holdersCounts <= 3 && elapsedMonitoringMs >= 120 * 1e3)
        ) {
            if (buyPosition) {
                logger.info('The token is probably dumped and we will sell at loss, sell=true');
                sell = {
                    reason: 'DUMPED',
                };
            } else {
                const reason = `Stopped monitoring token ${tokenMint} because it was probably dumped and current market cap is less than the initial one`;
                logger.info(reason);

                result = {
                    exitCode: 'DUMPED',
                    exitReason: reason,
                    history: history,
                };
                continue;
            }
        }

        if (!buyPosition && elapsedMonitoringMs >= maxWaitMs) {
            const reason = `Stopped monitoring token ${tokenMint}. We waited ${
                elapsedMonitoringMs / 1000
            } seconds and did not pump`;
            logger.info(reason);

            result = {
                exitCode: 'NO_PUMP',
                exitReason: reason,
                history: history,
            };
            continue;
        }

        if (buyPosition) {
            const priceDiffPercentageSincePurchase =
                ((price - buyPosition.priceInLamports) / buyPosition.priceInLamports) * 100;
            const diffInSol = lamportsToSol(
                price * buyPosition.amountRaw - Math.abs(buyPosition.netTransferredLamports),
            );

            logger.info('Price change since purchase %s%%', priceDiffPercentageSincePurchase);
            logger.info('Estimated sol diff %s', diffInSol);

            if (takeProfitPercentage && takeProfitPercentage.updatePrice(price)) {
                sell = {
                    reason: 'TAKE_PROFIT',
                };
                logger.info('Triggered take profit at price %s. %o', price, takeProfitPercentage);
            } else if (trailingTakeProfit && trailingTakeProfit.updatePrice(price)) {
                sell = {
                    reason: 'TRAILING_TAKE_PROFIT',
                };
                logger.info('Triggered trailing take profit at price %s. %o', price, trailingTakeProfit);
            } else if (!sell && trailingStopLoss!.updatePrice(price)) {
                sell = {
                    reason: 'TRAILING_STOP_LOSS',
                };
                logger.info(
                    'Triggered trailing stop loss at price %s with %s%% trailingPercentage and stopPrice %s',
                    price,
                    trailingStopLoss!.getTrailingPercentage(),
                    trailingStopLoss!.getStopPrice(),
                );
            } else if (diffInSol >= 0.2) {
                sell = {
                    reason: 'AT_HARDCODED_PROFIT',
                };
            }
        }

        // eslint-disable-next-line no-unreachable
        if (!buyPosition && buy) {
            // TODO calculate dynamically based on the situation
            const inSol = 0.4;
            const buyRes = (await measureExecutionTime(
                () =>
                    pumpfun.buy({
                        transactionMode: simulate ? TransactionMode.Simulation : TransactionMode.Execution,
                        payerPrivateKey: walletInfo.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        solIn: inSol,
                        slippageDecimal: 0.5,
                        priorityFeeInSol: 0.005,
                    }),
                `pumpfun.buy${SIMULATE ? '_simulation' : ''}`,
                { storeImmediately: true },
            )) as unknown as PumpfunBuyResponse;

            buyPosition = {
                timestamp: Date.now(),
                amountRaw: buyRes.boughtAmountRaw,
                grossReceivedLamports: buyRes.txDetails.grossTransferredLamports,
                netTransferredLamports: buyRes.txDetails.netTransferredLamports,
                pumpInSol: inSol,
                pumpMaxSolCost: buyRes.pumpMaxSolCost,
                pumpTokenOut: buyRes.pumpTokenOut,
                priceInLamports: price,
                marketCap: marketCap,
            };
            /**
             * The longer the buy transaction takes the more likely price has changed, so need to put limit orders with most closely price to the one used to buy
             * TODO calculate real buy price based on buyRes details and set up the limits accordingly
             */
            trailingStopLoss = new TrailingStopLoss(price, 15);
            takeProfitPercentage = new TakeProfitPercentage(price, 15);
            // trailingTakeProfit = new TrailingTakeProfit({
            //     entryPrice: price,
            //     trailingProfitPercentage: 15,
            //     trailingStopPercentage: 20,
            // });
            sleepIntervalMs = SELL_MONITOR_WAIT_PERIOD_MS;

            logger.info(
                'Bought successfully %s amountRaw for %s sol. buyRes=%o',
                buyRes!.boughtAmountRaw,
                inSol,
                buyRes,
            );
        }

        if (sell && buyPosition) {
            const sellRes = (await measureExecutionTime(
                () =>
                    pumpfun.sell({
                        transactionMode: simulate ? TransactionMode.Simulation : TransactionMode.Execution,
                        payerPrivateKey: walletInfo.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        slippageDecimal: 0.5,
                        tokenBalance: buyPosition!.amountRaw,
                        priorityFeeInSol: 0.005,
                    }),
                `pumpfun.sell${SIMULATE ? '_simulation' : ''}`,
                { storeImmediately: true },
            )) as unknown as PumpfunSellResponse;
            logger.info(
                'We sold successfully %s amountRaw with reason %s and received net %s sol. sellRes=%o',
                sellRes.soldRawAmount,
                sell.reason,
                lamportsToSol(sellRes.txDetails.netTransferredLamports),
                sellRes,
            );

            const sellPosition: SellPosition = {
                timestamp: Date.now(),
                amountRaw: sellRes.soldRawAmount,
                grossReceivedLamports: sellRes.txDetails.grossTransferredLamports,
                netReceivedLamports: sellRes.txDetails.netTransferredLamports,
                pumpMinLamportsOutput: sellRes.minLamportsOutput,
                priceInLamports: price,
                marketCap: marketCap,
                reason: sell.reason,
            };
            const pnlLamports = buyPosition.netTransferredLamports + sellPosition.netReceivedLamports;

            result = {
                trade: {
                    buyPosition: buyPosition,
                    sellPositions: [sellPosition],
                    netPnl: {
                        inLamports: pnlLamports,
                        inSol: lamportsToSol(pnlLamports),
                    },
                },
                history: history,
            };
            continue;
        }

        await sleep(sleepIntervalMs);
    }
}

/**
 * Will return -1 devHoldingPercentage if no creator is passed and can't calculate the value
 */
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
    tokenHolders.sort((a, b) => b.balance - a.balance);
    let devHolding = 0;

    const holdersCounts = tokenHolders.length;
    let topTenHolding = 0;
    let allHolding = 0;
    for (let i = 0; i < tokenHolders.length; i++) {
        const tokenHolder = tokenHolders[i];
        if (tokenHolder.ownerAddress === creator) {
            devHolding = tokenHolder.balance;
        }

        if (i < 10) {
            topTenHolding += tokenHolder.balance;
        }
        allHolding += tokenHolder.balance;
    }

    const topTenHoldingPercentage = (topTenHolding / allHolding) * 100;
    const devHoldingPercentage = creator === undefined ? -1 : (devHolding / allHolding) * 100;

    return {
        holdersCounts,
        devHoldingPercentage,
        topTenHoldingPercentage,
    };
}
