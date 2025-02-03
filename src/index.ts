import dotenv from 'dotenv';

import Pumpfun from './blockchains/solana/dex/pumpfun/Pumpfun';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const pumpfun = new Pumpfun({
        solanaWebsocketUrl: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    await pumpfun.listenForPumpFunTokens(data => {
        console.log(data);
    });
}
