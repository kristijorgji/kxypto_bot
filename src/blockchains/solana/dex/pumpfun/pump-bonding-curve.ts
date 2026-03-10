import { BondingCurve, PUMP_SDK } from '@pump-fun/pump-sdk';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { PUMPFUN_TOKEN_DECIMALS } from '@src/blockchains/solana/dex/pumpfun/constants';
import { getBondingCurveAddress } from '@src/blockchains/solana/dex/pumpfun/pump-pda';
import { BondingCurveFullState, BondingCurveState } from '@src/blockchains/solana/dex/pumpfun/types';
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

    return {
        accountInfo: bcAccountInfo,
        state: fromSdkBondingCurve(bondingCurve.toBase58(), PUMP_SDK.decodeBondingCurve(bcAccountInfo)),
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

export function computePriceInSol(bc: BondingCurve): number {
    const marketCap = bc.virtualSolReserves.div(new BN(LAMPORTS_PER_SOL));
    const totalCoins = bc.virtualTokenReserves.div(new BN(10 ** PUMPFUN_TOKEN_DECIMALS));

    return marketCap.div(totalCoins).toNumber();
}

export function fromSdkBondingCurve(bcAddress: string, bc: BondingCurve): BondingCurveState {
    return {
        dev: bc.creator.toBase58(),
        bondingCurve: bcAddress,
        virtualSolReserves: bc.virtualSolReserves.toNumber(),
        virtualTokenReserves: bc.virtualTokenReserves.toNumber(),
        realTokenReserves: bc.realTokenReserves.toNumber(),
        realSolReserves: bc.realSolReserves.toNumber(),
        tokenTotalSupply: bc.tokenTotalSupply.toNumber(),
        complete: bc.complete,
        isMayhemMode: bc.isMayhemMode,
        isCashbackCoin: bc.isCashbackCoin,
    };
}

export function toSdkBondingCurve(bc: BondingCurveState): BondingCurve {
    return {
        virtualTokenReserves: new BN(bc.virtualTokenReserves),
        virtualSolReserves: new BN(bc.virtualSolReserves),
        realTokenReserves: new BN(bc.realTokenReserves),
        realSolReserves: new BN(bc.realSolReserves),
        tokenTotalSupply: new BN(bc.tokenTotalSupply),
        complete: bc.complete,
        creator: new PublicKey(bc.dev),
        isMayhemMode: bc.isMayhemMode,
        isCashbackCoin: bc.isCashbackCoin,
    };
}
