import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { measureExecutionTime } from '@src/apm/apm';
import { getAssociatedBondingCurveAddress, getBondingCurveAddress } from '@src/blockchains/solana/dex/pumpfun/pump-pda';
import Pumpfun from '@src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunSellResponse } from '@src/blockchains/solana/dex/pumpfun/types';
import { formPumpfunTokenUrl } from '@src/blockchains/solana/dex/pumpfun/utils/data';
import SolanaAdapter from '@src/blockchains/solana/SolanaAdapter';
import { TransactionMode } from '@src/blockchains/solana/types';
import Wallet from '@src/blockchains/solana/Wallet';
import { RetryConfig } from '@src/core/types';
import { logger } from '@src/logger';
import { sleep } from '@src/utils/functions';

/**
 * Just a utility function to sell automatically the specified pumpfun token or all if not specified from your wallet
 */
export async function sellPumpfunTokens({
    pumpfun,
    wallet,
    solanaAdapter,
    mint,
}: {
    pumpfun: Pumpfun;
    wallet: Wallet;
    solanaAdapter: SolanaAdapter;
    mint?: string;
}) {
    const tokenProgramId = TOKEN_2022_PROGRAM_ID.toBase58();
    for (const token of await solanaAdapter.getAccountTokens(wallet.address)) {
        if (!token.mint.endsWith('pump') && token.ifpsMetadata?.createdOn !== 'https://pump.fun') {
            continue;
        }

        if (mint && mint !== token.mint) {
            continue;
        }

        logger.info(
            `Will sell ${token.name}, ${formPumpfunTokenUrl(token.mint)} amount ${
                token.amount
            } before multiplying with decimals`,
        );

        const mintAddress = new PublicKey(token.mint);
        const bondingCurve = getBondingCurveAddress(mintAddress);
        const associatedBondingCurve = getAssociatedBondingCurveAddress(
            bondingCurve,
            mintAddress,
            TOKEN_2022_PROGRAM_ID,
        );

        const sellRes = (await measureExecutionTime(
            () =>
                pumpfun.sell({
                    transactionMode: TransactionMode.Execution,
                    wallet: wallet.toObject(),
                    tokenMint: token.mint,
                    tokenProgramId: tokenProgramId,
                    tokenBondingCurve: bondingCurve.toBase58(),
                    tokenAssociatedBondingCurve: associatedBondingCurve.toBase58(),
                    tokenBalance: token.amountRaw,
                    priorityFeeInSol: 0.002,
                }),
            'pumpfun.sell',
            { storeImmediately: true },
        )) as unknown as PumpfunSellResponse;

        logger.info('Sell transaction confirmed. %o', sellRes);
    }
}

export async function sellPumpfunTokensWithRetries({
    pumpfun,
    wallet,
    solanaAdapter,
    mint,
    retryConfig,
}: {
    pumpfun: Pumpfun;
    wallet: Wallet;
    solanaAdapter: SolanaAdapter;
    mint: string | undefined;
    retryConfig: RetryConfig;
}) {
    let { maxRetries, sleepMs } = retryConfig;
    let retries = 0;
    let error: Error | undefined;

    do {
        try {
            await sellPumpfunTokens({
                pumpfun: pumpfun,
                wallet: wallet,
                solanaAdapter: solanaAdapter,
                mint: mint,
            });
        } catch (e) {
            error = e as Error;
            sleepMs = typeof sleepMs === 'function' ? sleepMs(retries + 1) : sleepMs;
            logger.error(
                `failed selling pumpfun tokens, mint=${mint} on retry ${retries}, error: %s. Will retry after sleeping ${sleepMs}`,
                (error as Error).message,
            );
            if (sleepMs > 0) {
                await sleep(sleepMs);
            }
        }
    } while (error && retries++ < maxRetries);

    throw error;
}
