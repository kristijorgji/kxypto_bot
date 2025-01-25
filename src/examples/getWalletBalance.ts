import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import Wallet from '../blockchains/solana/Wallet';
import { logger } from '../logger';

dotenv.config();

/**
 * Example standalone script that gets and prints wallet balance
 */
(async () => {
    await start();
})();

async function start() {
    const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const wallet = new Wallet({
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
        provider: SolanaWalletProviders.TrustWallet,
    });
    await wallet.init();
    logger.info(`Wallet Balance: ${await wallet.getBalance(connection)}`);
}
