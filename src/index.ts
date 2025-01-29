import dotenv from 'dotenv';

import { SolanaWalletProviders } from './blockchains/solana/constants/walletProviders';
import HeliusProvider from './blockchains/solana/providers/helius/HeliusProvider';
import solanaMnemonicToKeypair from './blockchains/solana/utils/solanaMnemonicToKeypair';
import { logger } from './logger';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const tokenMint = '6pqhKDyRwUcC9dPywg4s43HsvWoEvN6NHyKQvhdipump';
    const heliusConfig = {
        rpcUrl: process.env.HELIUS_RPC_ENDPOINT as string,
        apiKey: process.env.HELIUS_API_TOKEN as string,
    };

    const heliusProvider = new HeliusProvider({
        rpcUrl: process.env.HELIUS_RPC_ENDPOINT as string,
        apiKey: process.env.HELIUS_API_TOKEN as string,
    });

    const tokenHolders = await heliusProvider.getTokenHolders(heliusConfig, tokenMint);
    logger.info(`Token holders for the mint ${tokenMint} are %o`, tokenHolders);

    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    const walletAssets = await heliusProvider.getAssetsByOwner(heliusConfig, walletInfo.address);

    logger.info('Wallet %o assets are %o', walletInfo.address, walletAssets);
}
