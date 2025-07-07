import { TokenHolder } from '@src/blockchains/solana/types';

export default function calculateHoldersStats({
    tokenHolders,
    totalSupply,
    creator,
    bondingCurve,
}: {
    tokenHolders: TokenHolder[];
    totalSupply: number;
    creator: string;
    bondingCurve: string;
}): {
    holdersCount: number;
    devHoldingPercentage: number;
    topTenHoldingPercentage: number;
    circulatingSupply: number;
    devHoldingPercentageCirculating: number;
    topTenHoldingPercentageCirculating: number;
    topHolderCirculatingPercentage: number | null;
} {
    tokenHolders.sort((a, b) => b.balance - a.balance);
    let devHolding = 0;

    const holdersCount = tokenHolders.length;
    let topTenHolding = 0;
    let topTenHoldingIndex = 0;
    let circulatingSupply = 0;
    let topHolderHolding: number | null = null;

    for (let i = 0; i < tokenHolders.length; i++) {
        const tokenHolder = tokenHolders[i];

        if (tokenHolder.ownerAddress === bondingCurve) {
            // ignore the liquidity pool
            continue;
        }

        if (topHolderHolding === null) {
            topHolderHolding = tokenHolder.balance;
        }

        circulatingSupply += tokenHolder.balance;

        if (tokenHolder.ownerAddress === creator) {
            devHolding = tokenHolder.balance;
        }

        if (topTenHoldingIndex++ < 10) {
            topTenHolding += tokenHolder.balance;
        }
    }

    return {
        holdersCount: holdersCount,
        devHoldingPercentage: (devHolding / totalSupply) * 100,
        topTenHoldingPercentage: (topTenHolding / totalSupply) * 100,
        circulatingSupply: circulatingSupply,
        devHoldingPercentageCirculating: (devHolding / circulatingSupply) * 100,
        topTenHoldingPercentageCirculating: (topTenHolding / circulatingSupply) * 100,
        topHolderCirculatingPercentage: topHolderHolding === null ? null : (topHolderHolding / circulatingSupply) * 100,
    };
}
