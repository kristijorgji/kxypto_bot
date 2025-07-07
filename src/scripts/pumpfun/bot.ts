import fs from 'fs';
import path from 'path';

import '@src/core/loadEnv';
import { Command } from 'commander';
import { Logger } from 'winston';
import { z } from 'zod';

import { startApm } from '@src/apm/apm';
import { SolanaWalletProviders } from '@src/blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '@src/blockchains/solana/dex/pumpfun/mappers/mappers';
import { NewPumpFunTokenData } from '@src/blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '@src/blockchains/solana/dex/pumpfun/utils';
import { solanaConnection } from '@src/blockchains/solana/utils/connection';
import { lamportsToSol } from '@src/blockchains/utils/amount';
import { redis } from '@src/cache/cache';
import { db } from '@src/db/knex';
import { pumpfunRepository } from '@src/db/repositories/PumpfunRepository';
import { insertLaunchpadTokenResult } from '@src/db/repositories/tokenAnalytics';
import { logger } from '@src/logger';
import { parsePumpfunBotFileConfig } from '@src/trading/bots/blockchains/solana/pumpfun-bot-config-parser';
import {
    BotExitResponse,
    BotResponse,
    BotTradeResponse,
    HandlePumpTokenBaseReport,
    HandlePumpTokenBotReport,
    HandlePumpTokenReport,
} from '@src/trading/bots/blockchains/solana/types';
import { BotManagerConfig, Schema } from '@src/trading/bots/types';
import LaunchpadBotStrategy from '@src/trading/strategies/launchpads/LaunchpadBotStrategy';
import { randomInt } from '@src/utils/data/data';
import { sleep } from '@src/utils/functions';
import { extractHostAndPort } from '@src/utils/http';
import { ensureDataFolder } from '@src/utils/storage';
import { getSecondsDifference } from '@src/utils/time';

import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import PumpfunQueuedListener from '../../blockchains/solana/dex/PumpfunQueuedListener';
import SolanaAdapter from '../../blockchains/solana/SolanaAdapter';
import Wallet from '../../blockchains/solana/Wallet';
import isTokenCreatorSafe from '../../trading/bots/blockchains/solana/isTokenCreatorSafe';
import PumpfunBot, { ErrorMessage } from '../../trading/bots/blockchains/solana/PumpfunBot';
import PumpfunBotEventBus from '../../trading/bots/blockchains/solana/PumpfunBotEventBus';
import PumpfunBotTradeManager from '../../trading/bots/blockchains/solana/PumpfunBotTradeManager';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';

const EnvConfigSchema = z.object({
    marketContextProvider: z.object({
        measureExecutionTime: z.boolean(),
    }),
});

type EnvConfig = z.infer<typeof EnvConfigSchema>;

const ReportSchema: Schema = {
    version: 1.41,
};

const rpcProvider: HandlePumpTokenBaseReport['rpcProvider'] = {
    domain: extractHostAndPort(process.env.SOLANA_RPC_ENDPOINT as string).host,
};

const defaultConfig: BotManagerConfig = {
    reportSchema: ReportSchema,
    simulate: false,
    maxTokensToProcessInParallel: 70,
    maxOpenPositions: 2,
    buyMonitorWaitPeriodMs: 2500,
    sellMonitorWaitPeriodMs: 250,
    maxWaitMonitorAfterResultMs: 30 * 1e3,
    autoSellTimeoutMs: 120 * 1e3,
    buyInSol: 0.4,
    maxFullTrades: null,
    stopAtMinWalletBalanceLamports: null,
};

const runBotCommand = new Command();
runBotCommand
    .name('pumpfun-bot')
    .description('It will run the bot with the desired config')
    .version('0.0.0')
    .option('--config <string>', 'path to a config file used for this run')
    .action(async args => {
        await prepareAndStart({
            config: args.config,
        });
    });

// ensures the code only auto-runs when the file is executed directly, not when imported
if (require.main === module) {
    runBotCommand.parse();
}

async function prepareAndStart(args: { config?: string }) {
    const startDeps = {
        logger: logger,
        botEventBus: new PumpfunBotEventBus(),
    };

    if (args.config) {
        logger.info('Running bot with config file %s', args.config);
        const config = parsePumpfunBotFileConfig(args.config, ReportSchema);
        return await start(config.runConfig, startDeps, config.strategyFactory);
    }

    await start(
        defaultConfig,
        startDeps,
        () =>
            new RiseStrategy(logger, {
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
            }),
    );
}

export async function start(
    config: BotManagerConfig,
    {
        logger,
        botEventBus,
    }: {
        logger: Logger;
        botEventBus: PumpfunBotEventBus;
    },
    strategyFactory: () => LaunchpadBotStrategy,
) {
    const envConfig = getBotEnvConfig();
    startApm(rpcProvider.domain);

    {
        const _strategy = strategyFactory();
        logger.info(
            '🚀 Bot started with config=%o\nenvConfig=%o\nprovider=%o\nstrategy %s with variant config %s, config:%o',
            config,
            envConfig,
            rpcProvider,
            _strategy.identifier,
            _strategy.configVariant,
            _strategy.config,
        );
    }

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const solanaAdapter = new SolanaAdapter(solanaConnection);
    const marketContextProvider = new PumpfunMarketContextProvider(pumpfun, solanaAdapter, {
        measureExecutionTime: envConfig.marketContextProvider.measureExecutionTime,
    });

    const wallet = await new Wallet(solanaConnection, {
        provider: SolanaWalletProviders.TrustWallet,
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
    }).init(config.simulate);

    logger.info(`Started with balance ${lamportsToSol(await wallet.getBalanceLamports())} SOL`);

    const pumpfunBotTradeManager = new PumpfunBotTradeManager(
        logger,
        botEventBus,
        wallet,
        {
            maxOpenPositions: config.maxOpenPositions,
            maxFullTrades: config.maxFullTrades,
            minWalletBalanceLamports: config.stopAtMinWalletBalanceLamports,
        },
        {
            resumeListening: () => {
                logger.info(
                    'botManager - resuming token monitoring — open positions are now below maxOpenPositions limit',
                );
                pumpfunListener.startListening(true);
            },
        },
    );

    const pumpfunListener = new PumpfunQueuedListener(
        logger,
        pumpfun,
        config.maxTokensToProcessInParallel,
        async (identifier, data) => {
            try {
                const handleRes = await handlePumpToken(
                    {
                        logger,
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
                    strategyFactory,
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
                    pumpfunBotTradeManager.stopAllBots('insufficient_funds');
                } else {
                    logger.error(e);
                }
            }
        },
    );

    botEventBus.onStopBot(async ({ reason }) => {
        logger.info('botManager - onStopBot asking pumpfunQueuedListener to stop with reason %s', reason);
        await pumpfunListener.stopListening(true);
    });

    pumpfunListener.startListening(false);

    while (!pumpfunListener.isDone()) {
        await sleep(500);
    }

    logger.info('We are done. The listener is force stopped and all items are processed');
    logger.info('Balance: %s SOL', lamportsToSol(await wallet.getBalanceLamports()));
    await db.destroy();
    redis.disconnect();
}

async function handlePumpToken(
    {
        logger,
        pumpfun,
        solanaAdapter,
        marketContextProvider,
        botEventBus,
    }: {
        logger: Logger;
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
        config: BotManagerConfig;
        wallet: Wallet;
        tokenData: NewPumpFunTokenData;
    },
    strategyFactory: () => LaunchpadBotStrategy,
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
        $schema: c.reportSchema,
        simulation: c.simulate,
        rpcProvider: rpcProvider,
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

    const strategy = strategyFactory();
    const handleRes = await pumpfunBot.run(identifier, initialCoinData, strategy);

    const endedAt = new Date();
    await storeResult({
        $schema: baseReport.$schema,
        simulation: baseReport.simulation,
        rpcProvider: baseReport.rpcProvider,
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
            buyTimeframeMs: c.buyMonitorWaitPeriodMs,
            sellTimeframeMs: c.sellMonitorWaitPeriodMs,
        },
        ...handleRes,
    } satisfies HandlePumpTokenBotReport);

    return handleRes;
}

async function storeResult(report: HandlePumpTokenReport) {
    fs.writeFileSync(ensureDataFolder(`pumpfun-stats/tmp/${report.mint}.json`), JSON.stringify(report, null, 2));
    await insertLaunchpadTokenResult(
        {
            simulation: report.simulation,
            chain: 'solana',
            platform: 'pumpfun',
            mint: report.mint,
            creator: report.creator,
            net_pnl: (report as BotTradeResponse)?.netPnl?.inSol ?? null,
            exit_code: (report as BotExitResponse)?.exitCode ?? null,
            exit_reason: (report as BotExitResponse)?.exitReason ?? null,
        },
        report,
    );
}

function getBotEnvConfig(): EnvConfig {
    const file = path.join(__dirname, 'config/bot.json');
    const defaultsFile = path.join(__dirname, 'config/bot.defaults.json');

    if (fs.existsSync(file)) {
        return EnvConfigSchema.parse(JSON.parse(fs.readFileSync(file).toString()));
    }

    if (fs.existsSync(defaultsFile)) {
        return EnvConfigSchema.parse(JSON.parse(fs.readFileSync(defaultsFile, 'utf-8')));
    }

    throw new Error('No config found: please create config/bot.json or config/bot.defaults.json');
}
