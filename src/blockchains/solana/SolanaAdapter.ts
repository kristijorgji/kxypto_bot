import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';
import { getMint } from '@solana/spl-token';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';

import { TOKEN_METADATA_PROGRAM_ID, TOKEN_PROGRAM_ID } from './constants/core';
import { TokenInWalletFullInfo } from './types';
import { logger } from '../../logger';

export default class SolanaAdapter {
    private readonly connection: Connection;

    constructor(config: { rpcEndpoint: string; wsEndpoint: string }) {
        this.connection = new Connection(config.rpcEndpoint, {
            wsEndpoint: config.wsEndpoint,
        });
    }

    async getCirculatingSupply(tokenAddress: string) {
        return await this.connection.getTokenSupply(new PublicKey(tokenAddress));
    }

    /**
     * This will get all SPL tokens of the given wallet
     * and enrich them with the metadata and other information
     * This uses many concurrent calls if you have a lot of token accounts!
     * You can use fetchInParallel=false
     * or just pay for an RPC Node with high limits
     */
    async getTokenAccountsByOwner(
        walletAddress: string,
        args?: {
            fetchInParallel?: boolean;
        },
    ): Promise<TokenInWalletFullInfo[]> {
        const walletPublicKey = new PublicKey(walletAddress);

        const walletTokenAccounts = await this.connection.getTokenAccountsByOwner(walletPublicKey, {
            programId: TOKEN_PROGRAM_ID,
        });

        if (args?.fetchInParallel ?? true) {
            return (
                await Promise.all(
                    (walletTokenAccounts.value as Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>[]).map(
                        async value => {
                            try {
                                logger.info(`Fetching ${value}`);
                                return await this.parseWalletTokenData(value);
                            } catch (e) {
                                logger.error('Error fetching token full associated data %o', e);
                                return null;
                            }
                        },
                    ),
                )
            ).filter(value => value !== null) as TokenInWalletFullInfo[];
        } else {
            const data: TokenInWalletFullInfo[] = [];
            for (const account of walletTokenAccounts.value as Readonly<{
                account: AccountInfo<Buffer>;
                pubkey: PublicKey;
            }>[]) {
                try {
                    data.push(await this.parseWalletTokenData(account));
                } catch (e) {
                    logger.error('Error fetching token full associated data %o', e);
                }
            }

            return data;
        }
    }

    private async parseWalletTokenData(
        associatedTokenAccount: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
    ): Promise<TokenInWalletFullInfo> {
        const accountInfo = SPL_ACCOUNT_LAYOUT.decode(associatedTokenAccount.account.data as Buffer);
        const mint = new PublicKey(accountInfo.mint); // Extract mint address

        // Fetch mint info to get decimals
        /**
         * TODO can cache this information as it almost never changes, only if authority has permission
         * also this call can be avoided because all pumpfun tokens ending with 'pump' have always 6 decimals
         */
        const mintInfo = await getMint(this.connection, mint);
        const decimals = mintInfo.decimals;

        // TODO can cache this information as it almost never changes, only if authority has permission
        const metadata = await this.getTokenMetadata(mint);

        // Extract raw amount and adjust it based on decimals
        // @ts-ignore
        const amountRaw: string = accountInfo.amount.toString();
        const amount = (Number(amountRaw) / Math.pow(10, decimals)).toFixed(decimals);

        return {
            associatedTokenAddress: associatedTokenAccount.pubkey.toBase58() as string,
            mint: mint.toBase58(),
            name: metadata.name,
            symbol: metadata.symbol,
            amountRaw: amountRaw,
            amount: amount,
            decimals: decimals,
        };
    }

    private async getTokenMetadata(mint: PublicKey): Promise<{
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
async function getMetadataPDA(mint: PublicKey): Promise<PublicKey> {
    return (
        await PublicKey.findProgramAddress(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )
    )[0];
}
