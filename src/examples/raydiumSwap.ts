import dotenv from 'dotenv';

import { SolanaTokenMints } from '../blockchains/constants/SolanaTokenMints';
import { SolanaWalletProviders } from '../blockchains/solana/constants/walletProviders';
import { swap } from '../blockchains/solana/dex/raydium/swap';
import { MainnetData, trimMainnetJson } from '../blockchains/solana/dex/raydium/trimMainnet';
import solanaMnemonicToKeypair from '../blockchains/solana/utils/solanaMnemonicToKeypair';
import { readBigJson } from '../blockchains/utils/files';

dotenv.config();

/**
 * TODO doesn't work yet
 */
(async () => {
    await start();
})();

async function start() {
    const swapPool = await readBigJson<MainnetData>('./data/raydium/mainnet.json');
    const trimmedLiquidityFilePath = './data/raydium/trimmed_mainnet.json';
    trimMainnetJson({
        mainnetData: swapPool,
        tokenAAddress: SolanaTokenMints.SOL,
        tokenBAddress: SolanaTokenMints.USDC,
        outputPath: trimmedLiquidityFilePath,
    });

    await swap({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        walletPrivateKey: (
            await solanaMnemonicToKeypair(process.env.WALLET_MNEMONIC_PHRASE as string, {
                provider: SolanaWalletProviders.TrustWallet,
            })
        ).privateKey,
        swapConfig: {
            executeSwap: true, // Send tx when true, simulate tx when false
            tokenAAmount: 0.001, // Swap 0.01 SOL for USDC in this example
            tokenAAddress: 'So11111111111111111111111111111111111111112', // Token to swap for the other, SOL in this case
            tokenBAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC address
            maxLamports: 1500000, // Micro lamports for priority fee
            direction: 'in' as 'in' | 'out', // Swap direction: 'in' or 'out'
            liquidityFile: trimmedLiquidityFilePath,
            maxRetries: 20,
        },
    });
}
