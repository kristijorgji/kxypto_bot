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
import { logger } from '../../logger';
import PumpfunBot from '../../trading/bots/blockchains/solana/PumpfunBot';
import PumpfunBotEventBus from '../../trading/bots/blockchains/solana/PumpfunBotEventBus';
import PumpfunBotsTradeManager from '../../trading/bots/blockchains/solana/PumpfunBotsTradeManager';
import { BotResponse, BotTradeResponse } from '../../trading/bots/blockchains/solana/types';
import { BotConfig } from '../../trading/bots/types';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';
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

export type HandlePumpTokenReport = {
    /**
     * This information is used to understand the content of this report
     * As it changes it is mandatory to document what version we stored for every report
     */
    $schema: {
        version: number;
        name?: string;
    };
    simulation: boolean;
    strategy: {
        id: string;
        name: string;
        configVariant: string;
    };
    mint: string;
    name: string;
    url: string;
    startedAt: Date;
    endedAt: Date;
    elapsedSeconds: number;
    monitor: {
        buyTimeframeMs: number;
        sellTimeframeMs: number;
    };
} & BotResponse;

const config: Config = {
    simulate: true,
    maxTokensToProcessInParallel: 10,
    buyMonitorWaitPeriodMs: 500,
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
    // eslint-disable-next-line no-new
    new PumpfunBotsTradeManager(logger, botEventBus, wallet, {
        maxFullTrades: config.maxFullTrades,
        minWalletBalanceLamports: config.stopAtMinWalletBalanceLamports,
    });

    const pumpfunListener = new PumpfunQueuedListener(
        logger,
        pumpfun,
        config.maxTokensToProcessInParallel,
        async (identifier, data) => {
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

    try {
        const initialCoinData = pumpCoinDataToInitialCoinData(
            await pumpfun.getCoinDataWithRetries(tokenData.mint, {
                maxRetries: 10,
                sleepMs: retryCount => (retryCount <= 5 ? 250 : 500),
            }),
        );
        await pumpfunRepository.insertToken(initialCoinData);

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
            variant: 'hc_15_bcp_20_dhp_10_tthp_5_tslp_10_tpp_30',
            buy: {
                holdersCount: { min: 15 },
                bondingCurveProgress: { min: 20 },
                devHoldingPercentage: { max: 10 },
                topTenHoldingPercentage: { max: 5 },
            },
            sell: {
                takeProfitPercentage: 30,
                trailingStopLossPercentage: 10,
            },
            maxWaitMs: 300000,
            priorityFeeInSol: 0.005,
            buySlippageDecimal: 0.25,
            sellSlippageDecimal: 0.25,
        });
        const handleRes = await pumpfunBot.run(identifier, initialCoinData, strategy);

        const endedAt = new Date();
        await fs.writeFileSync(
            ensureDataFolder(`pumpfun-stats/${tokenData.mint}.json`),
            JSON.stringify(
                {
                    $schema: {
                        version: 1.06,
                    },
                    simulation: c.simulate,
                    strategy: {
                        id: strategy.identifier,
                        name: strategy.name,
                        configVariant: strategy.configVariant,
                    },
                    mint: tokenData.mint,
                    name: tokenData.name,
                    url: formPumpfunTokenUrl(tokenData.mint),
                    startedAt: startedAt,
                    endedAt: endedAt,
                    elapsedSeconds: getSecondsDifference(startedAt, endedAt),
                    monitor: {
                        buyTimeframeMs: config.buyMonitorWaitPeriodMs,
                        sellTimeframeMs: config.sellMonitorWaitPeriodMs,
                    },
                    ...handleRes,
                } as HandlePumpTokenReport,
                null,
                2,
            ),
        );

        return handleRes;
    } catch (e) {
        logger.error('[%s] Failed handling pump token %s', identifier, tokenData.mint);
        logger.error(e);

        return null;
    }
}
