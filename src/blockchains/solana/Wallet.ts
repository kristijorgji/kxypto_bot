import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { SolanaWalletProviders } from './constants/walletProviders';
import solanaMnemonicToKeypair from './utils/solanaMnemonicToKeypair';

export default class Wallet {
    private privateKey: string = '';
    private address: string = '';

    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly config: { mnemonic: string; provider: keyof typeof SolanaWalletProviders }) {}

    async init(): Promise<void> {
        const info = await solanaMnemonicToKeypair(this.config.mnemonic, {
            provider: this.config.provider,
        });

        this.privateKey = info.privateKey;
        this.address = info.address;
    }

    async getBalance(connection: Connection): Promise<number> {
        const balance = await connection.getBalance(new PublicKey(this.address));

        return balance / LAMPORTS_PER_SOL;
    }
}
