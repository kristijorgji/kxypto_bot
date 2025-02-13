import dotenv from 'dotenv';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { solanaConnection } from '../blockchains/solana/utils/connection';
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
    const wallet = new Wallet({
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
        provider: SolanaWalletProviders.TrustWallet,
    });
    await wallet.init();
    logger.info(`Wallet Balance: ${await wallet.getBalance(solanaConnection)}`);
}
