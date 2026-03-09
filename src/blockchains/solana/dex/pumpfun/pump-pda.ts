import { Buffer } from 'buffer';

import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { PUMP_FUN_PROGRAM } from '@src/blockchains/solana/dex/pumpfun/constants';

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

export function getAssociatedBondingCurveAddress(
    bondingCurveAddress: PublicKey,
    mintAddress: PublicKey,
    tokenProgram: PublicKey,
): PublicKey {
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [bondingCurveAddress.toBuffer(), tokenProgram.toBuffer(), mintAddress.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    return associatedBondingCurve;
}
