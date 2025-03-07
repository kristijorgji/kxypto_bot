import { Connection, PublicKey } from '@solana/web3.js';

import { SolanaWalletProviders } from './constants/walletProviders';
import solanaMnemonicToKeypair from './utils/solanaMnemonicToKeypair';

export default class Wallet {
    private _privateKey: string = '';
    get privateKey(): string {
        return this._privateKey;
    }

    private _address: string = '';
    get address(): string {
        return this._address;
    }

    private simulate: boolean = false;
    private _balanceLamports: number = -1;

    // eslint-disable-next-line no-useless-constructor
    constructor(
        private readonly connection: Connection,
        private readonly config: { mnemonic: string; provider: keyof typeof SolanaWalletProviders },
    ) {}

    async init(simulate: boolean): Promise<this> {
        this.simulate = simulate;

        const info = await solanaMnemonicToKeypair(this.config.mnemonic, {
            provider: this.config.provider,
        });

        this._privateKey = info.privateKey;
        this._address = info.address;

        return this;
    }

    async getBalanceLamports(): Promise<number> {
        if (this._balanceLamports === -1) {
            this._balanceLamports = await this.connection.getBalance(new PublicKey(this._address));
        }

        if (this.simulate) {
            return this._balanceLamports;
        }

        return await this.connection.getBalance(new PublicKey(this._address));
    }

    /**
     * Used during simulations
     */
    modifyBalance(amountLamports: number): number {
        this._balanceLamports += amountLamports;

        return this._balanceLamports;
    }
}
