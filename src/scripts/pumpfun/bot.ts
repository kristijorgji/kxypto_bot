import fs from 'fs';

import dotenv from 'dotenv';
/* eslint-disable import/first */
dotenv.config();

import { startApm } from '../../apm/apm';
import { SolanaWalletProviders } from '../../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import { NewPumpFunTokenData } from '../../blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '../../blockchains/solana/dex/pumpfun/utils';
import PumpfunQueuedListener from '../../blockchains/solana/dex/PumpfunQueuedListener';
import SolanaAdapter from '../../blockchains/solana/SolanaAdapter';
import { solanaConnection } from '../../blockchains/solana/utils/connection';
import Wallet from '../../blockchains/solana/Wallet';
import { lamportsToSol } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { pumpfunRepository } from '../../db/repositories/PumpfunRepository';
import { insertLaunchpadTokenResult } from '../../db/repositories/tokenAnalytics';
import { logger } from '../../logger';
import isTokenCreatorSafe from '../../trading/bots/blockchains/solana/isTokenCreatorSafe';
import PumpfunBot, { ErrorMessage } from '../../trading/bots/blockchains/solana/PumpfunBot';
import PumpfunBotEventBus from '../../trading/bots/blockchains/solana/PumpfunBotEventBus';
import PumpfunBotsTradeManager from '../../trading/bots/blockchains/solana/PumpfunBotsTradeManager';
import { BotExitResponse, BotResponse, BotTradeResponse } from '../../trading/bots/blockchains/solana/types';
import { BotConfig } from '../../trading/bots/types';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';
import { randomInt } from '../../utils/data/data';
import { sleep } from '../../utils/functions';
import { ensureDataFolder } from '../../utils/storage';
import { getSecondsDifference } from '../../utils/time';

/**
 * Configuration options for the bot's processing behavior.
 */
type Config = {
    /**
     * The maximum number of tokens that can be processed in parallel.
     * - If set to `null`, there is no limit on parallel processing.
     * - If set to a number (e.g., `3`), the bot will process up to that many tokens simultaneously.
     */
    maxTokensToProcessInParallel: number | null;

    /**
     * The amount of full trades.
     * - If set to a number, the bot will process up to maximum 1 full trade (1 buy, 1 sell)
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    maxFullTrades: number | null;

    /**
     * Stop bots if this minimum balance is reached
     * - If set to a number, the bots will stop when this balance or lower is reached
     * - If set to `null`, the bot will process trades as long as it has enough balance
     */
    stopAtMinWalletBalanceLamports: number | null;
} & BotConfig;

type HandlePumpTokenBaseReport = {
    /**
     * This information is used to understand the content of this report
     * As it changes it is mandatory to document what version we stored for every report
     */
    $schema: {
        version: number;
        name?: string;
    };
    simulation: boolean;
    mint: string;
    name: string;
    url: string;
    bullXUrl: string;
    creator: string;
    startedAt: Date;
    endedAt: Date;
    elapsedSeconds: number;
};

export type HandlePumpTokenExitReport = HandlePumpTokenBaseReport & {
    exitCode: 'BAD_CREATOR';
    exitReason: string;
};

export type HandlePumpTokenBotReport = HandlePumpTokenBaseReport & {
    strategy: {
        id: string;
        name: string;
        configVariant: string;
    };
    monitor: {
        buyTimeframeMs: number;
        sellTimeframeMs: number;
    };
} & BotResponse;

export type HandlePumpTokenReport = HandlePumpTokenExitReport | HandlePumpTokenBotReport;

const config: Config = {
    simulate: false,
    maxTokensToProcessInParallel: 70,
    buyMonitorWaitPeriodMs: 2500,
    sellMonitorWaitPeriodMs: 250,
    maxWaitMonitorAfterResultMs: 30 * 1e3,
    buyInSol: 0.4,
    maxFullTrades: null,
    stopAtMinWalletBalanceLamports: null,
};

(async () => {
    await start();
})();

async function start() {
    startApm();

    logger.info('🚀 Bot started with config=%o', config);

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const solanaAdapter = new SolanaAdapter(solanaConnection);
    const marketContextProvider = new PumpfunMarketContextProvider(pumpfun, solanaAdapter);

    const wallet = await new Wallet(solanaConnection, {
        provider: SolanaWalletProviders.TrustWallet,
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
    }).init(config.simulate);

    logger.info(`Started with balance ${lamportsToSol(await wallet.getBalanceLamports())} SOL`);

    const botEventBus = new PumpfunBotEventBus();
    const pumpfunBotsTradeManager = new PumpfunBotsTradeManager(logger, botEventBus, wallet, {
        maxFullTrades: config.maxFullTrades,
        minWalletBalanceLamports: config.stopAtMinWalletBalanceLamports,
    });

    const pumpfunListener = new PumpfunQueuedListener(
        logger,
        pumpfun,
        config.maxTokensToProcessInParallel,
        async (identifier, data) => {
            try {
                const handleRes = await handlePumpToken(
                    {
                        pumpfun,
                        solanaAdapter,
                        marketContextProvider,
                        botEventBus: botEventBus,
                    },
                    {
                        identifier: identifier.toString(),
                        config: config,
                        wallet: wallet,
                        tokenData: data,
                    },
                );

                if (config.simulate) {
                    if (handleRes && (handleRes as BotTradeResponse).transactions) {
                        logger.info(
                            '[%s] Simulated new balance: %s SOL',
                            identifier,
                            lamportsToSol(await wallet.getBalanceLamports()),
                        );
                    }
                }
            } catch (e) {
                logger.error('[%s] Failed handling pump token %s', identifier, data.mint);

                if ((e as Error).message === ErrorMessage.insufficientFundsToBuy) {
                    logger.warn('We got error %s and will stop all bots', ErrorMessage.insufficientFundsToBuy);
                    pumpfunBotsTradeManager.stopAllBots();
                } else {
                    logger.error(e);
                }
            }
        },
    );

    botEventBus.onStopBot(async () => {
        logger.info('bot - onStopBot asking pumpfunQueuedListener to stop');
        await pumpfunListener.stopListening(true);
    });

    pumpfunListener.startListening();

    while (!pumpfunListener.isDone()) {
        await sleep(500);
    }
    await sleep(1e4);
    logger.info('We are done. The listener is force stopped and all items are processed');
    logger.info('Balance: %s SOL', lamportsToSol(await wallet.getBalanceLamports()));
    await db.destroy();
}

async function handlePumpToken(
    {
        pumpfun,
        solanaAdapter,
        marketContextProvider,
        botEventBus,
    }: {
        pumpfun: Pumpfun;
        solanaAdapter: SolanaAdapter;
        marketContextProvider: PumpfunMarketContextProvider;
        botEventBus: PumpfunBotEventBus;
    },
    {
        identifier,
        config: c,
        wallet,
        tokenData,
    }: {
        identifier: string;
        config: Config;
        wallet: Wallet;
        tokenData: NewPumpFunTokenData;
    },
): Promise<BotResponse | null> {
    const startedAt = new Date();

    logger.info(
        '[%s] Received newly created token: %s, %s',
        identifier,
        tokenData.name,
        formPumpfunTokenUrl(tokenData.mint),
    );

    const initialCoinData = pumpCoinDataToInitialCoinData(
        await pumpfun.getCoinDataWithRetries(tokenData.mint, {
            maxRetries: 10,
            sleepMs: retryCount => (retryCount <= 5 ? randomInt(250, 1000) : retryCount * randomInt(500, 2500)),
        }),
    );
    await pumpfunRepository.insertToken(initialCoinData);

    const isCreatorSafeResult = await isTokenCreatorSafe(initialCoinData.creator);

    const baseReport: HandlePumpTokenBaseReport = {
        $schema: {
            version: 1.1,
        },
        simulation: c.simulate,
        mint: tokenData.mint,
        name: tokenData.name,
        url: formPumpfunTokenUrl(tokenData.mint),
        bullXUrl: `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenData.mint}`,
        creator: initialCoinData.creator,
        startedAt: startedAt,
        endedAt: startedAt,
        elapsedSeconds: 0,
    };

    if (!isCreatorSafeResult.safe) {
        logger.info(
            '[%s] Skipping this token because its creator %s is not safe, %s',
            identifier,
            initialCoinData.creator,
            isCreatorSafeResult.reason,
        );
        const endedAt = new Date();
        await storeResult({
            ...baseReport,
            endedAt: endedAt,
            elapsedSeconds: getSecondsDifference(startedAt, endedAt),
            exitCode: 'BAD_CREATOR',
            exitReason: `Skipping this token because its creator is not detected as safe, reason=${isCreatorSafeResult.reason}`,
        });

        return null;
    }

    const pumpfunBot = new PumpfunBot({
        logger: logger.child({
            contextMap: {
                listenerId: identifier,
            },
        }),
        pumpfun: pumpfun,
        solanaAdapter: solanaAdapter,
        marketContextProvider: marketContextProvider,
        wallet: wallet,
        config: c,
        botEventBus: botEventBus,
    });

    const strategy = new RiseStrategy(logger, {
        variant: 'hc_10_bcp_22_dhp_7_tthp_10_tslp_10_tpp_17',
        buy: {
            holdersCount: { min: 10 },
            bondingCurveProgress: { min: 22 },
            devHoldingPercentage: { max: 7 },
            topTenHoldingPercentage: { max: 10 },
        },
        sell: {
            takeProfitPercentage: 17,
            trailingStopLossPercentage: 10,
        },
        maxWaitMs: 7 * 60 * 1e3,
        priorityFeeInSol: 0.005,
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
    });
    const handleRes = await pumpfunBot.run(identifier, initialCoinData, strategy);

    const endedAt = new Date();
    await storeResult({
        $schema: baseReport.$schema,
        simulation: baseReport.simulation,
        strategy: {
            id: strategy.identifier,
            name: strategy.name,
            configVariant: strategy.configVariant,
        },
        mint: baseReport.mint,
        name: baseReport.name,
        url: baseReport.url,
        bullXUrl: baseReport.bullXUrl,
        creator: baseReport.creator,
        startedAt: baseReport.startedAt,
        endedAt: endedAt,
        elapsedSeconds: getSecondsDifference(startedAt, endedAt),
        monitor: {
            buyTimeframeMs: config.buyMonitorWaitPeriodMs,
            sellTimeframeMs: config.sellMonitorWaitPeriodMs,
        },
        ...handleRes,
    } as HandlePumpTokenBotReport);

    return handleRes;
}

async function storeResult(report: HandlePumpTokenReport) {
    await fs.writeFileSync(ensureDataFolder(`pumpfun-stats/tmp/${report.mint}.json`), JSON.stringify(report, null, 2));
    await insertLaunchpadTokenResult({
        simulation: report.simulation,
        chain: 'solana',
        platform: 'pumpfun',
        mint: report.mint,
        creator: report.creator,
        net_pnl: (report as BotTradeResponse)?.netPnl?.inSol ?? null,
        exit_code: (report as BotExitResponse)?.exitCode ?? null,
        exit_reason: (report as BotExitResponse)?.exitReason ?? null,
    });
}
