import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

import TokenMints from '../blockchains/constants/TokenMints';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import swap from '../blockchains/solana/dex/jupiter/swap';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { getTokenDecimals } from '../blockchains/solana/utils/tokens';
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
    const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    const r = await swap(connection, Keypair.fromSecretKey(Uint8Array.from(bs58.decode(walletInfo.privateKey))), {
        inputMint: TokenMints.USDC,
        outputMint: TokenMints.Solana,
        amount: 25.259 * 10 ** (await getTokenDecimals(connection, TokenMints.USDC)),
        slippagePercentage: 10,
    });

    logger.info('Successfully swapped');
    logger.info(r.solscanUrl);
}
