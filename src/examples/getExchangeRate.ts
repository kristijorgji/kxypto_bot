import axios from 'axios';

import CoinGecko from '../blockchains/solana/providers/coingecko/CoinGecko';
import { Coins, Currencies } from '../blockchains/solana/providers/coingecko/types';
import { logger } from '../logger';

(async () => {
    await start();
})();

/**
 * Example standalone script that gets the exchange rate of a coin
 */
async function start() {
    const coinGecko = new CoinGecko(axios.create());

    const { coin, currency, rate } = await coinGecko.getExchangeRate({
        coin: Coins.SOL,
        currency: Currencies.USD,
    });

    logger.info(`Exchange Rate => 1 ${coin} = ${rate} ${currency}`);
}
