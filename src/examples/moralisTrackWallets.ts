import '@src/loadEnv';

import Moralis from '../blockchains/solana/providers/moralis/Moralis';

/**
 * Example standalone script that checks the trades and portfolio of a requested walletyar
 */
(async () => {
    await start();
})();

async function start() {
    const moralis = new Moralis({
        apiKey: process.env.MORALIS_API_KEY as string,
    });

    const walletAddress = '8MqRTAQnjhDYH7TWS1b1DjFog4CLZfySWE5cZeotG2VW';

    const walletTokenSwaps = await moralis.getWalletTokenSwaps({
        walletAddress: walletAddress,
        transactionTypes: 'buy',
    });
    console.log('walletTokenSwaps', walletTokenSwaps);

    const walletTokenBalances = await moralis.getWalletTokenBalances({
        walletAddress: walletAddress,
    });
    console.log('walletTokenBalances', walletTokenBalances);

    const walletPortfolio = await moralis.getWalletPortfolio({
        walletAddress: walletAddress,
    });
    console.log('walletPortfolio', walletPortfolio);
}
