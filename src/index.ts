import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

import { SolanaWalletProviders } from './blockchains/solana/constants/walletProviders';
import { monitorNewTokens } from './blockchains/solana/dex/raydium/monitorNewTokens';
import Wallet from './blockchains/solana/Wallet';

dotenv.config();

(async () => {
    await start();
})();

async function start() {
    const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });

    await monitorNewTokens(connection, {
        dataPath: './data/new_solana_tokens.json',
    });

    const wallet = new Wallet({
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
        provider: SolanaWalletProviders.TrustWallet,
    });
    await wallet.init();
    console.log(`Wallet Balance: ${await wallet.getBalance(connection)}`);
}
