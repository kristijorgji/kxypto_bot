import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

import { SolanaTokenMints } from '../blockchains/constants/SolanaTokenMints';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { swap } from '../blockchains/solana/dex/raydium/swap';
import { TransactionMode } from '../blockchains/solana/types';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { solanaPrivateKeyToKeypair } from '../blockchains/solana/utils/solanaPrivateKeyToKeypair';
import { calculateTokenAmount } from '../blockchains/solana/utils/tokens';
import { logger } from '../logger';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    logger.info('Starting Raydium Swap!');

    const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT as string;
    const WALLET_MNEMONIC_PHRASE = process.env.WALLET_MNEMONIC_PHRASE as string;

    try {
        const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
        const walletInfo = await solanaMnemonicToKeypair(WALLET_MNEMONIC_PHRASE, {
            provider: SolanaWalletProviders.TrustWallet,
        });

        const swapResults = await swap({
            connection: connection,
            inputAmount: await calculateTokenAmount(0.01, SolanaTokenMints.WSOL, connection),
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
