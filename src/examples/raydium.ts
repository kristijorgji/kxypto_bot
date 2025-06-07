import '@src/loadEnv';

import { SolanaTokenMints } from '../blockchains/solana/constants/SolanaTokenMints';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { swap } from '../blockchains/solana/dex/raydium/swap';
import { TransactionMode } from '../blockchains/solana/types';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { solanaPrivateKeyToKeypair } from '../blockchains/solana/utils/solanaPrivateKeyToKeypair';
import { calculateTokenRawAmount } from '../blockchains/solana/utils/tokens';
import { logger } from '../logger';

(async () => {
    await start();
})();

async function start() {
    logger.info('Starting Raydium Swap!');

    const WALLET_MNEMONIC_PHRASE = process.env.WALLET_MNEMONIC_PHRASE as string;

    try {
        const walletInfo = await solanaMnemonicToKeypair(WALLET_MNEMONIC_PHRASE, {
            provider: SolanaWalletProviders.TrustWallet,
        });

        const swapResults = await swap({
            connection: solanaConnection,
            inputAmount: await calculateTokenRawAmount(solanaConnection, {
                mintAddress: SolanaTokenMints.WSOL,
                amount: 0.01,
            }),
            inputMint: SolanaTokenMints.WSOL,
            outputMint: SolanaTokenMints.USDC,
            slippageInPercent: 1,
            transactionMode: TransactionMode.Simulation,
            wallet: solanaPrivateKeyToKeypair(walletInfo.privateKey),
        });

        logger.info(`Swap Results: ${JSON.stringify(swapResults, null, 2)}`);
    } catch (e) {
        logger.error(`Error during Raydium Swap: ${e}`);
    }
}
