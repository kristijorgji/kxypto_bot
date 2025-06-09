import { publicKey, struct, u16, u64, u8 } from '@raydium-io/raydium-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { PUMP_AMM_PROGRAM, PUMP_FUN_PROGRAM } from './constants';

export type IPumpAmmData = {
    dev: string;
    pool: PublicKey;
    poolBaseTokenAccount: PublicKey;
    poolBaseTokenReserves: number;
    poolQuoteTokenAccount: PublicKey;
    poolQuoteTokenReserves: number;
};

function poolPda(
    index: number,
    owner: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    programId: PublicKey = PUMP_AMM_PROGRAM,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from('pool'),
            new BN(index).toArrayLike(Buffer, 'le', 2),
            owner.toBuffer(),
            baseMint.toBuffer(),
            quoteMint.toBuffer(),
        ],
        programId,
    );
}

function pumpPoolAuthorityPda(mint: PublicKey, pumpProgramId: PublicKey = PUMP_FUN_PROGRAM): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), mint.toBuffer()], pumpProgramId);
}

function canonicalPumpPoolPda(
    mint: PublicKey,
    programId: PublicKey = PUMP_AMM_PROGRAM,
    pumpProgramId: PublicKey = PUMP_FUN_PROGRAM,
): [PublicKey, number] {
    const [pumpPoolAuthority] = pumpPoolAuthorityPda(mint, pumpProgramId);

    return poolPda(
        0, //CANONICAL_POOL_INDEX,
        pumpPoolAuthority,
        mint,
        NATIVE_MINT,
        programId,
    );
}

export async function getPumpAmmData(connection: Connection, mint: string): Promise<IPumpAmmData | null> {
    const pool = canonicalPumpPoolPda(new PublicKey(mint))[0];
    const accountInfo = await connection.getAccountInfo(pool);
    if (!accountInfo) {
        return null;
    }

    const poolStructure = struct([
        u8('poolBump'),
        u16('index'),
        publicKey('creator'),
        publicKey('baseMint'),
        publicKey('quoteMint'),
        publicKey('lpMint'),
        publicKey('poolBaseTokenAccount'),
        publicKey('poolQuoteTokenAccount'),
        u64('lpSupply'),
        publicKey('coinCreator'),
    ]);

    const dataWithoutDiscriminator = accountInfo.data.slice(8);

    // Then decode using your struct
    const decoded = poolStructure.decode(dataWithoutDiscriminator);

    const [baseTokenBalance, quoteTokenBalance] = await Promise.all([
        connection.getTokenAccountBalance(decoded.poolBaseTokenAccount),
        connection.getTokenAccountBalance(decoded.poolQuoteTokenAccount),
    ]);

    const poolBaseTokenReserves = Number(baseTokenBalance.value.amount);
    const poolQuoteTokenReserves = Number(quoteTokenBalance.value.amount);

    return {
        dev: decoded.coinCreator.toString(),
        pool,
        poolBaseTokenAccount: decoded.poolBaseTokenAccount,
        poolBaseTokenReserves,
        poolQuoteTokenAccount: decoded.poolQuoteTokenAccount,
        poolQuoteTokenReserves,
    };
}
