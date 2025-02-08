import { Connection, ParsedAccountData, PublicKey } from '@solana/web3.js';
import axios from 'axios';

import { IfpsMetadata } from '../types';

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

export async function calculateTokenAmount(
    amount: number,
    mintAddress: string,
    connection: Connection,
): Promise<number> {
    return amount * 10 ** (await getTokenDecimals(connection, mintAddress));
}

export async function getTokenIfpsMetadata(uri: string): Promise<IfpsMetadata> {
    return (
        await axios.get(uri, {
            headers: {
                // Without user agent you may get forbidden error
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            },
        })
    ).data as IfpsMetadata;
}
