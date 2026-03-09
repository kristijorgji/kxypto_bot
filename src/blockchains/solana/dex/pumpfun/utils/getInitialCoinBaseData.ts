import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { RpcAccount } from '@metaplex-foundation/umi';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

import { getTokenBondingCurveState } from '@src/blockchains/solana/dex/pumpfun/pump-bonding-curve';
import { getAssociatedBondingCurveAddress } from '@src/blockchains/solana/dex/pumpfun/pump-pda';
import { PumpfunInitialCoinData } from '@src/blockchains/solana/dex/pumpfun/types';
import { getMetadataPDA } from '@src/blockchains/solana/SolanaAdapter';
import { getTokenIfpsMetadata } from '@src/blockchains/solana/utils/tokens';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getInitialCoinBaseData(
    connection: Connection,
    mint: string,
    tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<PumpfunInitialCoinData> {
    const mintKey = new PublicKey(mint);
    const { state: bcState } = await getTokenBondingCurveState(connection, { mint: mint });

    const metadataPDA = await getMetadataPDA(mintKey);
    const metaDataAccountInfo = await connection.getAccountInfo(metadataPDA);
    const metadata = deserializeMetadata(metaDataAccountInfo! as unknown as RpcAccount);

    const ipfsMetadata = await getTokenIfpsMetadata(metadata.uri);

    return {
        mint: mint,
        tokenProgramId: tokenProgramId.toString(),
        creator: bcState.dev,
        // TODO find a way to fetch createdTimestamp via Pumpfun.getInitialCoinBaseData
        createdTimestamp: Date.now(),
        bondingCurve: bcState.bondingCurve,
        associatedBondingCurve: getAssociatedBondingCurveAddress(
            new PublicKey(bcState.bondingCurve),
            mintKey,
            tokenProgramId,
        ).toBase58(),
        name: ipfsMetadata.name,
        symbol: ipfsMetadata.symbol,
        description: ipfsMetadata.description,
        image: ipfsMetadata.image,
        twitter: ipfsMetadata.twitter,
        telegram: ipfsMetadata.telegram,
        website: ipfsMetadata.website,
    };
}
