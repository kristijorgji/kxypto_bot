import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

import BirdEye from './blockchains/solana/providers/birdeye/BirdEye';
import Moralis from './blockchains/solana/providers/moralis/Moralis';
import Solana from './blockchains/solana/Solana';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const tokenMint = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

    const birdEye = new BirdEye({
        url: process.env.BIRDEYE_API_ENDPOINT as string,
        apiKey: process.env.BIRDEYE_API_TOKEN as string,
    });
    // const r = await birdEye.getTrades(tokenMint);
    // console.log(r);
    const price = await birdEye.getPrice(tokenMint);
    console.log('price', price);

    const supply = await new Solana().getCirculatingSupply(
        new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        }),
        tokenMint,
    );
    console.log('supply', supply);

    const moralis = new Moralis({
        apiKey: process.env.MORALIS_API_KEY as string,
    });

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
}
