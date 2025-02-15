import { Coins, Currencies, getExchangeRate } from '../blockchains/solana/providers/coingecko/getExchangeRate';
import { logger } from '../logger';

(async () => {
    await start();
})();

/**
 * Example standalone script that gets the exchange rate of a coin
 */
async function start() {
    const { coin, currency, rate } = await getExchangeRate({
        coin: Coins.SOL,
        currency: Currencies.USD,
    });

    logger.info(`Exchange Rate => 1 ${coin} = ${rate} ${currency}`);
}
