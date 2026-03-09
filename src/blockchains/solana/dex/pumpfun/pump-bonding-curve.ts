import { bool, publicKey, struct, u64 } from '@raydium-io/raydium-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { PUMPFUN_TOKEN_DECIMALS } from '@src/blockchains/solana/dex/pumpfun/constants';
import { getBondingCurveAddress } from '@src/blockchains/solana/dex/pumpfun/pump-pda';
import { BondingCurveFullState } from '@src/blockchains/solana/dex/pumpfun/types';
import { lamportsToSol } from '@src/blockchains/utils/amount';

export async function getTokenBondingCurveState(
    connection: Connection,
    p: {
        bondingCurve?: PublicKey;
        mint?: string;
    },
): Promise<BondingCurveFullState> {
    const bondingCurve = p.bondingCurve ?? getBondingCurveAddress(new PublicKey(p.mint!));

    const bcAccountInfo = await connection.getAccountInfo(new PublicKey(bondingCurve));
    if (!bcAccountInfo) {
        throw new Error(`Could not find bondingCurve accountInfo ${bondingCurve}`);
    }

    const structure = struct([
        u64('discriminator'),
        u64('virtualTokenReserves'),
        u64('virtualSolReserves'),
        u64('realTokenReserves'),
        u64('realSolReserves'),
        u64('tokenTotalSupply'),
        bool('complete'),
        publicKey('creator'),
    ]);
    const decoded = structure.decode(bcAccountInfo.data);

    return {
        accountInfo: bcAccountInfo,
        state: {
            dev: decoded.creator.toString(),
            bondingCurve: bondingCurve.toBase58(),
            virtualSolReserves: decoded.virtualSolReserves.toNumber(),
            virtualTokenReserves: decoded.virtualTokenReserves.toNumber(),
            realTokenReserves: decoded.realTokenReserves.toNumber(),
            realSolReserves: decoded.realSolReserves.toNumber(),
            tokenTotalSupply: decoded.tokenTotalSupply.toNumber(),
            complete: decoded.complete,
        },
    };
}

export function computeBondingCurveMetrics({
    virtualSolReserves,
    virtualTokenReserves,
    tokenTotalSupply,
    realTokenReserves,
}: {
    virtualSolReserves: number;
    virtualTokenReserves: number;
    tokenTotalSupply: number;
    realTokenReserves: number;
}): {
    marketCapInSol: number;
    priceInSol: number;
    bondingCurveProgress: number;
} {
    const marketCap = lamportsToSol(virtualSolReserves);
    // dividing by 10^6 (as pump.fun has value till 6 decimal places)
    const totalCoins = virtualTokenReserves / 10 ** PUMPFUN_TOKEN_DECIMALS;
    const price = marketCap / totalCoins;

    // We multiply by 1000_000 as coin have value in 6 decimals
    const reservedTokens = new BN(206900000).mul(new BN(1000_000));
    const initialRealTokenReserves = new BN(tokenTotalSupply).sub(reservedTokens);
    const bondingCurveProgress = new BN(100).sub(
        new BN(realTokenReserves).mul(new BN(100)).div(initialRealTokenReserves),
    );

    return {
        marketCapInSol: marketCap,
        priceInSol: price,
        bondingCurveProgress: bondingCurveProgress.toNumber(),
    };
}
