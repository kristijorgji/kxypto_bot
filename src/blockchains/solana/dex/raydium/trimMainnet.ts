import fs from 'fs';

interface PoolInfo {
    id: string;
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    version: number;
    programId: string;
    authority: string;
    openOrders: string;
    targetOrders: string;
    baseVault: string;
    quoteVault: string;
    withdrawQueue: string;
    lpVault: string;
    marketVersion: number;
    marketProgramId: string;
    marketId: string;
    marketAuthority: string;
    marketBaseVault: string;
    marketQuoteVault: string;
    marketBids: string;
    marketAsks: string;
    marketEventQueue: string;
}

export type MainnetData = {
    official: PoolInfo[];
    unOfficial: PoolInfo[];
};

/**
 * It will read the full mainnet file and trim it to only the requested swap pair
 */
export function trimMainnetJson({
    mainnetData,
    tokenAAddress,
    tokenBAddress,
    outputPath,
}: {
    mainnetData: MainnetData;
    tokenAAddress: string;
    tokenBAddress: string;
    outputPath: string;
}) {
    // Find the pool that matches the token pair in both official and unofficial pools
    const relevantPool = [...mainnetData.official, ...(mainnetData.unOfficial || [])].find(
        (pool: PoolInfo) =>
            (pool.baseMint === tokenAAddress && pool.quoteMint === tokenBAddress) ||
            (pool.baseMint === tokenBAddress && pool.quoteMint === tokenAAddress),
    );

    if (!relevantPool) {
        throw new Error(`No matching pool found for the given token pair ${tokenAAddress} <==> ${tokenBAddress}`);
    }

    // Create a new object with only the necessary information
    const trimmedData = {
        official: [relevantPool],
    };

    // Write the trimmed data to a new file
    fs.writeFileSync(outputPath, JSON.stringify(trimmedData, null, 2));

    console.log(`Trimmed mainnet file has been created as ${outputPath}`);
}
