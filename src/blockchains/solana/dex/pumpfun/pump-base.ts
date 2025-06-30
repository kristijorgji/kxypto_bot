import { bool, publicKey, struct, u64 } from '@raydium-io/raydium-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    PUMPFUN_TOKEN_DECIMALS,
    PUMP_FUN_PROGRAM,
    TOKEN_PROGRAM_ID,
} from '@src/blockchains/solana/dex/pumpfun/constants';
import { lamportsToSol, solToLamports } from '@src/blockchains/utils/amount';

export function getCreatorVaultAddress(dev: string): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('creator-vault'), new PublicKey(dev).toBuffer()],
        PUMP_FUN_PROGRAM,
    )[0];
}

export function getBondingCurveAddress(mintAddress: PublicKey): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintAddress.toBytes()],
        PUMP_FUN_PROGRAM,
    );

    return bondingCurve;
}

export function getAssociatedBondingCurveAddress(bondingCurveAddress: PublicKey, mintAddress: PublicKey) {
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [bondingCurveAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    return associatedBondingCurve;
}

type BondingCurveState = {
    dev: string;
    bondingCurve: PublicKey;
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    realTokenReserves: BN;
    realSolReserves: BN;
    tokenTotalSupply: BN;
    complete: boolean;
};

export async function getTokenBondingCurveState(
    connection: Connection,
    p: {
        bondingCurve?: PublicKey;
        mint?: string;
    },
): Promise<BondingCurveState> {
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
        dev: decoded.creator.toString(),
        bondingCurve: bondingCurve,
        virtualSolReserves: decoded.virtualSolReserves,
        virtualTokenReserves: decoded.virtualTokenReserves,
        realTokenReserves: decoded.realTokenReserves,
        realSolReserves: decoded.realSolReserves,
        tokenTotalSupply: decoded.tokenTotalSupply,
        complete: decoded.complete,
    };
}

export function computeBondingCurveMetrics({
    virtualSolReserves,
    virtualTokenReserves,
    tokenTotalSupply,
    realTokenReserves,
}: {
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    tokenTotalSupply: BN;
    realTokenReserves: BN;
}): {
    marketCapInSol: number;
    priceInSol: number;
    bondingCurveProgress: number;
} {
    const marketCap = lamportsToSol(Number(virtualSolReserves));
    // dividing by 10^6 (as pump.fun has value till 6 decimal places)
    const totalCoins = Number(virtualTokenReserves) / 10 ** PUMPFUN_TOKEN_DECIMALS;
    const price = marketCap / totalCoins;

    // We multiply by 1000_000 as coin have value in 6 decimals
    const reservedTokens = new BN(206900000).mul(new BN(1000_000));
    const initialRealTokenReserves = new BN(Number(tokenTotalSupply)).sub(reservedTokens);
    const bondingCurveProgress = new BN(100).sub(
        new BN(Number(realTokenReserves)).mul(new BN(100)).div(initialRealTokenReserves),
    );

    return {
        marketCapInSol: marketCap,
        priceInSol: price,
        bondingCurveProgress: bondingCurveProgress.toNumber(),
    };
}

export function calculatePumpTokenLamportsValue(amountRaw: number, priceInSol: number): number {
    return solToLamports(priceInSol * (amountRaw / 10 ** PUMPFUN_TOKEN_DECIMALS));
}

export function calculateBuyPriceInLamports({
    amountRaw,
    grossTransferredLamports,
}: {
    amountRaw: number;
    grossTransferredLamports: number;
}): number {
    return (Math.abs(grossTransferredLamports) / amountRaw) * 10 ** PUMPFUN_TOKEN_DECIMALS;
}
