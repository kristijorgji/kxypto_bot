import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';
import { getMint } from '@solana/spl-token';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { isAxiosError } from 'axios';

import { logger } from '@src/logger';

import { TOKEN_METADATA_PROGRAM_ID, TOKEN_PROGRAM_ID } from './constants/core';
import { IfpsMetadata, TokenHolder, TokenInWalletFullInfo } from './types';
import { getTokenIfpsMetadata } from './utils/tokens';

export default class SolanaAdapter {
    constructor(private readonly connection: Connection) {}

    async getCirculatingSupply(tokenAddress: string) {
        return await this.connection.getTokenSupply(new PublicKey(tokenAddress));
    }

    /**
     * @see https://solana.stackexchange.com/a/15386/34703
     * This will work fine for tokens with up to 1-10k holders but have doubts in tokens like Trump
     * with hundred thousand holders. For large cap trading Moralis and providers are more fit atm as they
     * offer limits and pagination as well
     */
    async getTokenHolders({ tokenMint }: { tokenMint: string }): Promise<TokenHolder[]> {
        // SPL token accounts have a fixed size of 165 bytes.
        const tokenAccSize = 165;

        // Get all accounts owned by the token program that belong to the specified mint.
        // Filtering on dataSize and the mint field (at offset 0).
        const accounts = await this.connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
            filters: [{ dataSize: tokenAccSize }, { memcmp: { offset: 0, bytes: tokenMint } }],
        });

        const tokenHolders: TokenHolder[] = [];
        for (const acc of accounts) {
            const data = acc.account.data;
            // Extract the owner wallet address from bytes 32 to 63.
            const ownerBuffer = data.slice(32, 64);

            // Extract the token balance from bytes 64 to 71.
            const balance = data.readBigUInt64LE(64);

            // Skip token accounts with a zero balance.
            if (balance === BigInt(0)) {
                continue;
            }

            tokenHolders.push({
                tokenAccountAddress: acc.pubkey.toBase58(),
                ownerAddress: new PublicKey(ownerBuffer).toBase58(),
                balance: Number(balance),
            });
        }

        return tokenHolders;
    }

    async getBalance(walletAddress: string) {
        return await this.connection.getBalance(new PublicKey(walletAddress));
    }

    /**
     * This will get all SPL tokens of the given wallet
     * and enrich them with the metadata and other information
     * This uses many concurrent calls if you have a lot of token accounts!
     * You can use fetchInParallel=false
     * or just pay for an RPC Node with high limits
     */
    async getAccountTokens(
        walletAddress: string,
        args?: {
            fetchInParallel?: boolean;
        },
    ): Promise<TokenInWalletFullInfo[]> {
        const walletPublicKey = new PublicKey(walletAddress);

        const walletTokenAccounts = await this.connection.getTokenAccountsByOwner(walletPublicKey, {
            programId: TOKEN_PROGRAM_ID,
        });

        const nonZeroTokenAccounts: {
            associatedTokenAddress: string;
            mint: PublicKey;
            amountRaw: number;
        }[] = [];
        for (const associatedTokenAccount of walletTokenAccounts.value as Readonly<{
            account: AccountInfo<Buffer>;
            pubkey: PublicKey;
        }>[]) {
            const accountInfo = SPL_ACCOUNT_LAYOUT.decode(associatedTokenAccount.account.data as Buffer);
            const amount = Number(accountInfo.amount.toString());
            if (amount === 0) {
                continue;
            }

            nonZeroTokenAccounts.push({
                associatedTokenAddress: associatedTokenAccount.pubkey.toBase58(),
                mint: accountInfo.mint,
                amountRaw: amount,
            });
        }

        if (args?.fetchInParallel ?? true) {
            // @ts-ignore
            return await Promise.all(nonZeroTokenAccounts.map(this.parseWalletTokenData.bind(this)));
        } else {
            const data: TokenInWalletFullInfo[] = [];
            for (const account of nonZeroTokenAccounts) {
                data.push(await this.parseWalletTokenData(account));
            }

            return data;
        }
    }

    private async parseWalletTokenData(info: {
        associatedTokenAddress: string;
        mint: PublicKey;
        amountRaw: number;
    }): Promise<TokenInWalletFullInfo> {
        const mint = new PublicKey(info.mint); // Extract mint address

        // Fetch mint info to get decimals
        /**
         * TODO can cache this information as it almost never changes, only if authority has permission
         * also this call can be avoided because all pumpfun tokens ending with 'pump' have always 6 decimals
         */
        const mintInfo = await getMint(this.connection, mint);
        const decimals = mintInfo.decimals;

        // TODO can cache this information as it almost never changes, only if authority has permission
        const metadata = await this.getTokenMetadata(mint);

        const amount = (info.amountRaw / Math.pow(10, decimals)).toFixed(decimals);

        let ipfsMetadata: IfpsMetadata | undefined;
        if (metadata.uri.length > 0) {
            try {
                ipfsMetadata = await getTokenIfpsMetadata(metadata.uri);
            } catch (e) {
                let errorToThrow = e;
                if (isAxiosError(e)) {
                    if (e.code === 'ENOTFOUND') {
                        logger.warn(
                            `⚠️ Could not resolve IPFS gateway for ${metadata.uri}, skipping metadata fetch for mint ${mint}.`,
                        );
                        errorToThrow = null;
                    }
                }

                if (errorToThrow) {
                    throw errorToThrow;
                }
            }
        }

        return {
            associatedTokenAddress: info.associatedTokenAddress,
            mint: mint.toBase58(),
            name: metadata.name,
            symbol: metadata.symbol,
            amountRaw: info.amountRaw,
            amount: amount,
            decimals: decimals,
            ifpsMetadata: ipfsMetadata,
        };
    }

    public async getTokenMetadata(mint: PublicKey): Promise<{
        name: string;
        symbol: string;
        uri: string;
    }> {
        const metadataPDA = await getMetadataPDA(mint);
        const metaDataAccountInfo = await this.connection.getAccountInfo(metadataPDA);

        if (!metaDataAccountInfo) {
            throw new Error('no_metadata_account_info_fetched');
        }

        try {
            // @ts-ignore
            const metadata = deserializeMetadata(metaDataAccountInfo);
            return {
                name: metadata.name,
                symbol: metadata.symbol,
                uri: metadata.uri,
            };
        } catch (error) {
            throw new Error(`Error decoding metadata for ${mint.toBase58()}: ${(error as Error).message}`);
        }
    }
}

// Function to get Metadata PDA (Program Derived Address)
export async function getMetadataPDA(mint: PublicKey): Promise<PublicKey> {
    return (
        await PublicKey.findProgramAddress(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )
    )[0];
}
