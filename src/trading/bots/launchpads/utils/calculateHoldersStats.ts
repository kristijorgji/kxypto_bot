import { TokenHolder } from '../../../../blockchains/solana/types';

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
} {
    tokenHolders.sort((a, b) => b.balance - a.balance);
    let devHolding = 0;

    const holdersCount = tokenHolders.length;
    let topTenHolding = 0;
    let topTenHoldingIndex = 0;

    for (let i = 0; i < tokenHolders.length; i++) {
        const tokenHolder = tokenHolders[i];

        if (tokenHolder.ownerAddress === bondingCurve) {
            // ignore the liquidity pool
            continue;
        }

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
    };
}
