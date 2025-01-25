import { Connection, ParsedAccountData, PublicKey } from '@solana/web3.js';

/**
 * TODO Store in DB this cache info
 */
export async function getTokenDecimals(connection: Connection, mintAddress: string): Promise<number> {
    const mintPublicKey = new PublicKey(mintAddress);
    const mintAccountInfo = await connection.getParsedAccountInfo(mintPublicKey);

    if (mintAccountInfo.value === null) {
        throw new Error(`Mint account ${mintAddress} not found`);
    }

    const mintData = mintAccountInfo.value.data as ParsedAccountData;

    return mintData.parsed.info.decimals;
}
