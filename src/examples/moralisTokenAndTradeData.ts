import '@src/core/loadEnv';

import Moralis from '../blockchains/solana/providers/moralis/Moralis';
import SolanaAdapter from '../blockchains/solana/SolanaAdapter';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import { getDateSecondsAgo } from '../utils/time';

/**
 * Example standalone script that uses Moralis provider to get token data and price, also tokens pair trades and ino
 */
(async () => {
    await start();
})();

async function start() {
    const tokenMint = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

    const supply = await new SolanaAdapter(solanaConnection).getCirculatingSupply(tokenMint);
    console.log('supply', supply);

    const moralis = new Moralis({
        apiKey: process.env.MORALIS_API_KEY as string,
    });

    const tokenPrice = await moralis.getTokenPrice({
        tokenAddress: tokenMint,
    });
    console.log('tokenPrice', tokenPrice);

    const trades = await moralis.getTokenTrades({
        tokenAddress: tokenMint,
    });
    console.log('trades', trades);

    const pairs = await moralis.getTokenPairs({
        tokenAddress: tokenMint,
    });
    console.log('pairs', pairs);
    const pairStats = await moralis.getTokenPairStats(pairs.pairs[0].pairAddress);
    console.log('pairStats', pairStats);

    const pairTrades = await moralis.getPairTrades({
        pairAddress: pairs.pairs[0].pairAddress,
    });
    console.log('pairTrades', pairTrades);

    const ohlcvByPairAddress = await moralis.getOhlcvByPairAddress(pairs.pairs[0].pairAddress, {
        timeframe: '1s',
        fromDate: getDateSecondsAgo(3600 * 24),
        toDate: getDateSecondsAgo(0),
        currency: 'usd',
    });
    console.log('ohlcvByPairAddress', ohlcvByPairAddress);
}
