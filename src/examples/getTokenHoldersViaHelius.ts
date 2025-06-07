import '@src/loadEnv';

import HeliusProvider from '../blockchains/solana/providers/helius/HeliusProvider';
import { logger } from '../logger';

/**
 * Example standalone script that gets the holders of a token using Helius
 */
(async () => {
    await start();
})();

async function start() {
    const tokenMint = '6pqhKDyRwUcC9dPywg4s43HsvWoEvN6NHyKQvhdipump';

    const heliusProvider = new HeliusProvider({
        rpcUrl: process.env.HELIUS_RPC_ENDPOINT as string,
        apiKey: process.env.HELIUS_API_TOKEN as string,
    });

    const tokenHolders = await heliusProvider.getTokenHolders({
        tokenAddress: tokenMint,
    });
    logger.info(`Token holders for the mint ${tokenMint} are %o`, tokenHolders);
}
