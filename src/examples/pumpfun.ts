import '@src/loadEnv';

import { measureExecutionTime } from '../apm/apm';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunSellResponse,
} from '../blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl, sellPumpfunTokens } from '../blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { TransactionMode } from '../blockchains/solana/types';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import Wallet from '../blockchains/solana/Wallet';
import { logger } from '../logger';
import { sleep } from '../utils/functions';

/**
 * Example standalone script that demos buying a newly created token in pumpfun and selling it after 7 seconds
 */
(async () => {
    await start();
})();

async function start() {
    const shouldSellPumpTokens = false;

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const wallet = await new Wallet(solanaConnection, {
        provider: SolanaWalletProviders.TrustWallet,
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
    }).init(false);

    if (shouldSellPumpTokens) {
        await sellPumpfunTokens({
            pumpfun: pumpfun,
            wallet: wallet,
            solanaAdapter: new SolanaAdapter(solanaConnection),
            // mint: '5qS8Rt2Ec33ouJyi91kPWYnmSqZR3uCvb4THr2Jupump',
        });
        return;
    }

    const maxTokensToSnipe = 1;
    let snipped = 0;

    await pumpfun.listenForPumpFunTokens(async data => {
        if (snipped >= maxTokensToSnipe) {
            logger.info(
                `Returning and stopping listener as we snipped already maximum specified tokens ${maxTokensToSnipe}`,
            );
            pumpfun.stopListeningToNewTokens();
            return;
        }
        snipped++;

        const tokenMint = data.mint;

        logger.info('Will snipe new pumpfun token %s %s', data.name, formPumpfunTokenUrl(tokenMint));

        let initialCoinData: PumpfunInitialCoinData;
        try {
            initialCoinData = pumpCoinDataToInitialCoinData(
                await pumpfun.getCoinDataWithRetries(tokenMint, {
                    maxRetries: 4,
                    sleepMs: 250,
                }),
            );
        } catch (_) {
            logger.warn('Failed to fetch full token initial data, will use our own fallback');
            initialCoinData = await pumpfun.getInitialCoinBaseData(tokenMint);
        }

        try {
            const inSol = 0.001;
            logger.info(`Will buy ${inSol} sol`);
            const buyRes = (await measureExecutionTime(
                () =>
                    pumpfun.buy({
                        transactionMode: TransactionMode.Execution,
                        payerPrivateKey: wallet.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        solIn: inSol,
                        slippageDecimal: 0.5,
                        priorityFeeInSol: 0.002,
                        jitoConfig: {
                            jitoEnabled: true,
                        },
                    }),
                'pumpfun.buy',
                { storeImmediately: true },
            )) as unknown as PumpfunBuyResponse;

            logger.info(
                'Bought successfully %s amountRaw for %s sol. Full info %o',
                buyRes.boughtAmountRaw,
                inSol,
                buyRes,
            );

            logger.info('Sleeping 5s then selling');
            await sleep(7000);

            const sellRes = (await measureExecutionTime(
                () =>
                    pumpfun.sell({
                        transactionMode: TransactionMode.Execution,
                        payerPrivateKey: wallet.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        slippageDecimal: 0.5,
                        tokenBalance: buyRes.boughtAmountRaw,
                        priorityFeeInSol: 0.002,
                        jitoConfig: {
                            jitoEnabled: true,
                        },
                    }),
                'pumpfun.sell',
                { storeImmediately: true },
            )) as unknown as PumpfunSellResponse;

            logger.info('Sold successfully %o', sellRes);
        } catch (e) {
            console.error(e);
        }
    });
}
