import '@src/core/loadEnv';
import fs from 'fs';

import { monitorNewTokens } from '../blockchains/solana/dex/raydium/monitorNewTokens';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import { logger } from '../logger';
import { ensureDataFolder } from '../utils/storage';

/**
 * Example standalone script that listens for new raydium liquidity pool transactions, extracts the necessary information for additional use, and stores it
 */
(async () => {
    await start();
})();

async function start() {
    await monitorNewTokens(solanaConnection, {
        onNewToken: async newTokenData => {
            logger.info('New RaydiumTokenCreated: %o', newTokenData);
            const newTokensFile = ensureDataFolder('new_solana_tokens.json');
            if (!fs.existsSync(newTokensFile)) {
                fs.writeFileSync(newTokensFile, '[]');
            }
            await fs.writeFileSync(newTokensFile, JSON.stringify(newTokenData, null, 2));
        },
    });
}
