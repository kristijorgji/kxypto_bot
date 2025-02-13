import dotenv from 'dotenv';

import { SolanaTokenMints } from '../blockchains/solana/constants/SolanaTokenMints';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import swap from '../blockchains/solana/dex/jupiter/swap';
import { solanaConnection } from '../blockchains/solana/utils/connection';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { solanaPrivateKeyToKeypair } from '../blockchains/solana/utils/solanaPrivateKeyToKeypair';
import { calculateTokenRawAmount } from '../blockchains/solana/utils/tokens';
import { logger } from '../logger';

dotenv.config();

/**
 * Example standalone script buys & sells token by swapping using Jupiter DEX
 */
(async () => {
    await start();
})();

async function start() {
    const walletInfo = await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
        provider: SolanaWalletProviders.TrustWallet,
    });

    const r = await swap(solanaConnection, solanaPrivateKeyToKeypair(walletInfo.privateKey), {
        inputMint: SolanaTokenMints.USDC,
        outputMint: SolanaTokenMints.WSOL,
        amount: await calculateTokenRawAmount(solanaConnection, {
            mintAddress: SolanaTokenMints.USDC,
            amount: 25.259,
        }),
        slippagePercentage: 10,
    });

    logger.info('Successfully swapped');
    logger.info(r.solscanUrl);
}
