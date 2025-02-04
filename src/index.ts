import dotenv from 'dotenv';

import SolanaAdapter from './blockchains/solana/SolanaAdapter';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const tokens = await new SolanaAdapter({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    }).getTokenAccountsByOwner('8MqRTAQnjhDYH7TWS1b1DjFog4CLZfySWE5cZeotG2VW', {
        fetchInParallel: false,
    });

    console.log('tokens', tokens);
}
