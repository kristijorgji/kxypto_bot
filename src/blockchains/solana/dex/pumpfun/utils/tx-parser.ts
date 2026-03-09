import { ParsedInstruction, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

import { calculatePriceInLamports } from '@src/blockchains/solana/dex/pumpfun/pump-base';
import { PumpfunTransactionErrorType, SolPumpfunTransactionDetails } from '@src/blockchains/solana/dex/pumpfun/types';
import { SolFullTransactionDetails } from '@src/blockchains/solana/types';

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
