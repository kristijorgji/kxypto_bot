import dotenv from 'dotenv';

import { measureExecutionTime } from '../apm/apm';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { pumpCoinDataToInitialCoinData } from '../blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import {
    PumpfunBuyResponse,
    PumpfunInitialCoinData,
    PumpfunSellResponse,
} from '../blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '../blockchains/solana/dex/pumpfun/utils';
import { TransactionMode } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { logger } from '../logger';
import { sleep } from '../utils/functions';

dotenv.config();

/**
 * Example standalone script that demos buying a newly created token in pumpfun and selling it after 7 seconds
 */
(async () => {
    await start();
})();

async function start() {
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    // await sellAllPumpfunTokens({
    //     pumpfun: pumpfun,
    //     walletInfo: walletInfo,
    //     solanaAdapter: new SolanaAdapter(solanaConnection),
    // });
    // return;

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
        } catch (e) {
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
                        payerPrivateKey: walletInfo.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        solIn: inSol,
                        slippageDecimal: 0.5,
                        priorityFeeInSol: 0.002,
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
                        payerPrivateKey: walletInfo.privateKey,
                        tokenMint: tokenMint,
                        tokenBondingCurve: initialCoinData.bondingCurve,
                        tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
                        slippageDecimal: 0.5,
                        tokenBalance: buyRes.boughtAmountRaw,
                        priorityFeeInSol: 0.002,
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
