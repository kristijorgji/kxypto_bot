import { bool, publicKey, struct, u64 } from '@raydium-io/raydium-sdk';
import { Connection, ParsedInstruction, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    PUMPFUN_TOKEN_DECIMALS,
    PUMP_FUN_PROGRAM,
    TOKEN_PROGRAM_ID,
} from '@src/blockchains/solana/dex/pumpfun/constants';
import { PumpfunTransactionErrorType, SolPumpfunTransactionDetails } from '@src/blockchains/solana/dex/pumpfun/types';
import { SolFullTransactionDetails } from '@src/blockchains/solana/types';
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

export type BondingCurveState = {
    dev: string;
    bondingCurve: string;
    virtualSolReserves: number;
    virtualTokenReserves: number;
    realTokenReserves: number;
    realSolReserves: number;
    tokenTotalSupply: number;
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
        bondingCurve: bondingCurve.toBase58(),
        virtualSolReserves: decoded.virtualSolReserves.toNumber(),
        virtualTokenReserves: decoded.virtualTokenReserves.toNumber(),
        realTokenReserves: decoded.realTokenReserves.toNumber(),
        realSolReserves: decoded.realSolReserves.toNumber(),
        tokenTotalSupply: decoded.tokenTotalSupply.toNumber(),
        complete: decoded.complete,
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

function getRawTokensMoved(tx: ParsedTransactionWithMeta, userWallet: string, mintAddress: string): bigint {
    if (!tx.meta) {
        throw new Error('tx.meta is missing');
    }

    const pre = tx.meta.preTokenBalances?.find(b => b.owner === userWallet && b.mint === mintAddress);
    const post = tx.meta.postTokenBalances?.find(b => b.owner === userWallet && b.mint === mintAddress);

    if (!post) {
        return 0n;
    }

    const preAmount = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
    const postAmount = BigInt(post.uiTokenAmount.amount);

    return postAmount - preAmount;
}

export function extractPossibleErrorFromTx(tx: SolFullTransactionDetails): SolPumpfunTransactionDetails {
    const transaction = tx.fullTransaction;

    let error: unknown;
    let errorType: PumpfunTransactionErrorType | undefined;
    if (transaction.meta?.err) {
        error = transaction.meta?.err;

        for (const log of transaction.meta.logMessages ?? []) {
            if (log.includes('Transfer: insufficient lamports')) {
                errorType = 'insufficient_lamports';
            } else if (
                log.includes('Error Message: slippage: Too much SOL required to buy the given amount of tokens..')
            ) {
                errorType = 'pumpfun_slippage_more_sol_required';
            } else if (log.includes('Error Message: Not enough tokens to sell.')) {
                errorType = 'pump_sell_not_enough_tokens';
            }

            if (errorType) {
                break;
            }
        }
        if (!errorType) {
            errorType = 'unknown';
        }
    }

    const { error: _e, fullTransaction: _f, ...rest } = tx;
    const r: SolPumpfunTransactionDetails = {
        ...rest,
    };

    if (errorType) {
        r.error = {
            type: errorType,
            object: error,
        };
    }

    return r;
}

export function extractBuyResultsFromTx(
    tx: ParsedTransactionWithMeta,
    userWallet: string,
    mintAddress: string,
    tokenBondingCurve: string,
): {
    priceLamports: number;
    amountRaw: number;
} {
    if (!tx.meta || !tx.meta.innerInstructions) {
        throw new Error('tx.meta or tx.meta.innerInstructions are missing');
    }

    let totalLamportsToCurve = 0;
    for (const inner of tx.meta.innerInstructions) {
        for (const instr of inner.instructions) {
            const pinstr = instr as ParsedInstruction;
            if (
                pinstr.program === 'system' &&
                pinstr.parsed?.type === 'transfer' &&
                pinstr.parsed.info?.source === userWallet &&
                tokenBondingCurve === pinstr.parsed.info.destination
            ) {
                totalLamportsToCurve += parseInt(pinstr.parsed.info.lamports, 10);
            }
        }
    }

    const amountRaw = Number(getRawTokensMoved(tx, userWallet, mintAddress));

    return {
        amountRaw: amountRaw,
        priceLamports: calculatePriceInLamports({
            amountRaw: amountRaw,
            lamports: totalLamportsToCurve,
        }),
    };
}

export function extractSellResultsFromTx(
    tx: ParsedTransactionWithMeta,
    userWallet: string,
    mintAddress: string,
    tokenBondingCurve: string,
): {
    amountRaw: number;
    priceLamports: number;
} {
    if (!tx.meta || !tx.meta.innerInstructions) {
        throw new Error('tx.meta or tx.meta.innerInstructions are missing');
    }

    const bondingCurveAddress = new PublicKey(tokenBondingCurve);

    const { meta, transaction } = tx;
    const { preBalances, postBalances } = meta;
    const accountKeys = transaction.message.accountKeys;

    // 1. Find index of bonding curve account
    const bondingCurveIndex = accountKeys.findIndex(acc => acc.pubkey.equals(bondingCurveAddress));
    if (bondingCurveIndex === -1) {
        throw new Error('Bonding curve address not found in transaction');
    }

    // 2. Calculate SOL received (difference in bonding curve account)
    const receivedLamportsFromCurve = preBalances[bondingCurveIndex] - postBalances[bondingCurveIndex];

    const amountRaw = Math.abs(Number(getRawTokensMoved(tx, userWallet, mintAddress)));

    return {
        amountRaw: amountRaw,
        priceLamports: calculatePriceInLamports({
            amountRaw: amountRaw,
            lamports: receivedLamportsFromCurve,
        }),
    };
}

export function calculatePumpTokenLamportsValue(amountRaw: number, priceInSol: number): number {
    return solToLamports(priceInSol * (amountRaw / 10 ** PUMPFUN_TOKEN_DECIMALS));
}

export function calculatePriceInLamports({ amountRaw, lamports }: { amountRaw: number; lamports: number }): number {
    return (Math.abs(lamports) / amountRaw) * 10 ** PUMPFUN_TOKEN_DECIMALS;
}
