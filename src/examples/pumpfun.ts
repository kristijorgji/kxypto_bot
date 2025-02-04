import dotenv from 'dotenv';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import Pumpfun from '../blockchains/solana/dex/pumpfun/Pumpfun';
import Moralis from '../blockchains/solana/providers/moralis/Moralis';
import { TransactionMode } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { logger } from '../logger';
import { sleep } from '../utils/functions';

dotenv.config();

/**
 * Example standalone script that demos buying a newly created token in pumpfun and selling it after 5 seconds
 */
(async () => {
    await start();
})();

async function start() {
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const moralis = new Moralis({
        apiKey: process.env.MORALIS_API_KEY as string,
    });

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    // await sellAllPumpfunStuff();
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

        logger.info('Will snipe new pumpfun token %s %s', data.name, `https://pump.fun/coin/${tokenMint}`);

        try {
            const inSol = 0.005;
            const buyRes = await pumpfun.buy({
                transactionMode: TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: tokenMint,
                solIn: inSol,
                slippageDecimal: 0.5,
                priorityFeeInSol: 0.002,
            });

            logger.info('Bought successfully %s amountRaw for %s sol', buyRes.boughtAmountRaw, inSol);

            logger.info('Sleeping 5s then selling');
            await sleep(5000);

            await pumpfun.sell({
                transactionMode: TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: tokenMint,
                slippageDecimal: 0.5,
                tokenBalance: buyRes.boughtAmountRaw,
                priorityFeeInSol: 0.002,
            });
        } catch (e) {
            console.error(e);
        }
    });

    /**
     * Just a utility function to sell automatically all tokens of pumpfun from your wallet
     * To clean up for tests DON'T USE IT without confirming your balances
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-unused-vars
    async function sellAllPumpfunStuff() {
        const portfolio = await moralis.getWalletPortfolio({
            walletAddress: walletInfo.address,
        });

        for (const token of portfolio.tokens) {
            if (!token.mint.endsWith('pump')) {
                continue;
            }

            logger.info(
                `Will sell ${token.name}, https://pump.fun/coin/${token.mint} amount ${token.amount} before multiplying with decimals`,
            );

            await pumpfun.sell({
                transactionMode: TransactionMode.Execution,
                payerPrivateKey: walletInfo.privateKey,
                tokenMint: token.mint,
                tokenBalance: parseFloat(token.amount) * 10 ** token.decimals,
                priorityFeeInSol: 0.002,
            });
        }
    }
}
