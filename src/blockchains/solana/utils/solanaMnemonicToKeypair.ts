import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import bs58 from 'bs58';
import * as ed25519 from 'ed25519-hd-key';

import { SolanaWalletProviders, solanaDerivationPaths } from '../constants/walletProviders';
import { WalletInfo } from '../types';

/**
 * Converts a mnemonic phrase to a Base58 private key and Solana wallet address.
 * @returns {Promise<{ privateKey: string, address: string }>} The private key (Base58-encoded) and Solana wallet address.
 */
export default async function solanaMnemonicToKeypair(
    mnemonic: string,
    config: {
        provider: keyof typeof SolanaWalletProviders;
    },
): Promise<WalletInfo> {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
    }

    const seed = await bip39.mnemonicToSeed(mnemonic);

    const derived = ed25519.derivePath(solanaDerivationPaths[config.provider], seed.toString('hex'));
    const privateKey = derived.key;

    const keypair = Keypair.fromSeed(privateKey); // Automatically derives the public key

    return {
        privateKey: bs58.encode(keypair.secretKey),
        address: keypair.publicKey.toBase58(),
    };
}
