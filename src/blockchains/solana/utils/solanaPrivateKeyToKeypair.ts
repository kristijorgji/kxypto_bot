import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Creates a Solana Keypair from a base58-encoded private key
 * @param privateKeyBase58 - The base58-encoded private key string
 * @returns The Solana {@link Keypair}
 * @example
 * const keypair = createKeypairFromPrivateKey('base58EncodedPrivateKey');
 */
export const solanaPrivateKeyToKeypair = (privateKeyBase58: string): Keypair =>
    Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKeyBase58)));
