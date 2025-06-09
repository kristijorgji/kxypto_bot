import { organizePumpfunFiles } from '@src/trading/backtesting/data/pumpfun/utils';

(async () => {
    await start();
})();

/**
 * It will organize the files under `./data/pumpfun-stats`
 * and move them into proper folders based on the handling result
 * if it was a trade, win, loss or exit for a particular reason
 */
async function start() {
    await organizePumpfunFiles();
}
