import '@src/loadEnv';

import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import Wallet from '../blockchains/solana/Wallet';
import { lamportsToSol } from '../blockchains/utils/amount';
import { logger } from '../logger';

/**
 * Example standalone script that gets and prints wallet balance
 */
(async () => {
    await start();
})();

async function start() {
    const wallet = new Wallet(solanaConnection, {
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
        provider: SolanaWalletProviders.TrustWallet,
    });
    await wallet.init(false);
    logger.info(`Wallet Balance: ${lamportsToSol(await wallet.getBalanceLamports())} SOL`);
}
