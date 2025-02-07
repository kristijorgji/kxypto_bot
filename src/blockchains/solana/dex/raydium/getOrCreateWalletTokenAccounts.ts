import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import { logger } from '../../../../logger';

export type GetOrCreateTokenAccountsParams = {
    connection: Connection;
    wallet: Keypair;
    inputMint: string;
    outputMint: string;
};

export type GetOrCreateTokenAccountsResponse = {
    inputTokenAccount: PublicKey;
    outputTokenAccount: PublicKey;
};

export async function getOrCreateWalletTokenAccounts({
    connection,
    wallet,
    inputMint,
    outputMint,
}: GetOrCreateTokenAccountsParams): Promise<GetOrCreateTokenAccountsResponse> {
    logger.info('Fetching wallet token accounts');
    const inputTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
            connection,
            wallet, // payer
            new PublicKey(inputMint), // mint
            wallet.publicKey, // owner
            false, // allowOwnerOffCurve
            'confirmed', // commitment
        )
    ).address;

    logger.info(`Input token account: ${inputTokenAccount.toString()}`);

    const outputTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
            connection,
            wallet,
            new PublicKey(outputMint),
            wallet.publicKey,
            false,
            'confirmed',
        )
    ).address;

    logger.info(`Output token account: ${outputTokenAccount.toString()}`);

    return {
        inputTokenAccount,
        outputTokenAccount,
    };
}
