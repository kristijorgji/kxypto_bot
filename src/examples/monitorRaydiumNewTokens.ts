import fs from 'fs';

import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

import { monitorNewTokens } from '../blockchains/solana/dex/raydium/monitorNewTokens';
import { logger } from '../logger';
import { ensureDataFolder } from '../utils/storage';

dotenv.config();

/**
 * Example standalone script that listens for new raydium liquidity pool transactions, extracts the necessary information for additional use, and stores it
 */
(async () => {
    await start();
})();

async function start() {
    const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    await monitorNewTokens(connection, {
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
