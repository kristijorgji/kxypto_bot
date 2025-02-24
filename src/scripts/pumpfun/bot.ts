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
import SolanaAdapter from '../../blockchains/solana/SolanaAdapter';
import { WalletInfo } from '../../blockchains/solana/types';
import { solanaConnection } from '../../blockchains/solana/utils/connection';
import solanaMnemonicToKeypair from '../../blockchains/solana/utils/solanaMnemonicToKeypair';
import { lamportsToSol } from '../../blockchains/utils/amount';
import { pumpfunRepository } from '../../db/repositories/PumpfunRepository';
import { logger } from '../../logger';
import PumpfunBot from '../../trading/bots/blockchains/solana/PumpfunBot';
import { BotResponse, BotTradeResponse } from '../../trading/bots/blockchains/solana/types';
import { BotConfig } from '../../trading/bots/types';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';
import UniqueRandomIntGenerator from '../../utils/data/UniqueRandomIntGenerator';
import { ensureDataFolder } from '../../utils/storage';

type ListenConfig = {
    maxTokensToProcessInParallel: number | null; // set to null for no parallel limits
} & BotConfig;

export type HandlePumpTokenReport = {
    schemaVersion: string; // our custom reporting schema version, used to filter the data in case we change content of the json report
    simulation: boolean;
    strategy: string; // a brief name of what we are trying to test, ex: take-profit-only
    mint: string;
    name: string;
    url: string;
    startedAt: Date;
    endedAt: Date;
} & BotResponse;

(async () => {
    await start();
})();

const listenConfig: ListenConfig = {
    simulate: true,
    maxTokensToProcessInParallel: 1,
    afterResultMonitorWaitPeriodMs: 500,
    maxWaitMonitorAfterResultMs: 30 * 1e3,
};

async function start() {
    startApm();

    const uniqueRandomIntGenerator = new UniqueRandomIntGenerator();

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const solanaAdapter = new SolanaAdapter(solanaConnection);
    const marketContextProvider = new PumpfunMarketContextProvider(pumpfun, solanaAdapter);

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    let balanceInLamports = await solanaAdapter.getBalance(walletInfo.address);
    logger.info(`Started with balance ${lamportsToSol(balanceInLamports)} SOL`);

    await listen(listenConfig);

    async function listen(c: ListenConfig) {
        const identifier = uniqueRandomIntGenerator.next().toString();
        let processed = 0;

        logger.info(
            '[%s] started listen, processed=%s, maxTokensToProcessInParallel=%s',
            identifier,
            processed,
            c.maxTokensToProcessInParallel,
        );

        balanceInLamports = c.simulate ? balanceInLamports : await solanaAdapter.getBalance(walletInfo.address);

        logger.info('[%s] balance %s SOL', identifier, lamportsToSol(balanceInLamports));

        await pumpfun.listenForPumpFunTokens(async data => {
            if (c.maxTokensToProcessInParallel && processed >= c.maxTokensToProcessInParallel) {
                logger.info(
                    '[%s] Returning and stopping listener as we processed already maximum specified tokens %d',
                    identifier,
                    c.maxTokensToProcessInParallel,
                );
                pumpfun.stopListeningToNewTokens();
                return;
            }
            processed++;

            const handleRes = await handlePumpToken(
                {
                    pumpfun,
                    marketContextProvider,
                },
                {
                    identifier,
                    config: c,
                    walletInfo,
                    tokenData: data,
                },
            );

            if (c.simulate) {
                if (handleRes && (handleRes as BotTradeResponse).transactions) {
                    const t = handleRes as BotTradeResponse;
                    balanceInLamports += t.netPnl.inLamports;
                    logger.info('[%s] Simulated new balance: %s', identifier, lamportsToSol(balanceInLamports));
                }
            }

            if (c.maxTokensToProcessInParallel && processed === c.maxTokensToProcessInParallel) {
                logger.info(
                    '[%s] Will return and start listen function again. Processed %d = maxTokensToProcessInParallel %d.',
                    identifier,
                    processed,
                    c.maxTokensToProcessInParallel,
                );

                return await listen(c);
            }
        });
    }
}

async function handlePumpToken(
    { pumpfun, marketContextProvider }: { pumpfun: Pumpfun; marketContextProvider: PumpfunMarketContextProvider },
    {
        identifier,
        config: c,
        walletInfo,
        tokenData,
    }: {
        identifier: string;
        config: ListenConfig;
        walletInfo: WalletInfo;
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
            marketContextProvider: marketContextProvider,
            walletInfo: walletInfo,
            config: c,
        });

        const strategy = new RiseStrategy(logger);
        const handleRes = await pumpfunBot.run(identifier, initialCoinData, strategy);

        await fs.writeFileSync(
            ensureDataFolder(`pumpfun-stats/${tokenData.mint}.json`),
            JSON.stringify(
                {
                    schemaVersion: '1.04',
                    simulation: c.simulate,
                    strategy: strategy.name,
                    mint: tokenData.mint,
                    name: tokenData.name,
                    url: formPumpfunTokenUrl(tokenData.mint),
                    startedAt: startedAt,
                    endedAt: new Date(),
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
