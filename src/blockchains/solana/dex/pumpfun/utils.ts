import { PublicKey } from '@solana/web3.js';

import { PUMPFUN_TOKEN_DECIMALS } from './constants';
import { pumpCoinDataToInitialCoinData } from './mappers/mappers';
import Pumpfun from './Pumpfun';
import { PumpfunInitialCoinData, PumpfunSellResponse } from './types';
import { measureExecutionTime } from '../../../../apm/apm';
import PumpfunRepository, { pumpfunRepository } from '../../../../db/repositories/PumpfunRepository';
import { logger } from '../../../../logger';
import { sleep } from '../../../../utils/functions';
import { solToLamports } from '../../../utils/amount';
import SolanaAdapter from '../../SolanaAdapter';
import { TransactionMode } from '../../types';
import Wallet from '../../Wallet';

export function formPumpfunTokenUrl(mint: string): string {
    return `https://pump.fun/coin/${mint}`;
}

/**
 * Retrieves the initial pump coin data.
 *
 * This function first attempts to fetch the data from the local database to minimize unnecessary API calls.
 * If the data is not found in the database, it will fallback to calling the pump API.
 * The function will continue to make API requests until the data is successfully retrieved.
 * Once the data is successfully fetched from the pump API, it will be stored in the local database for future use.
 *
 */
export async function forceGetPumpCoinInitialData(
    pumpfun: Pumpfun,
    repository: PumpfunRepository,
    mint: string,
): Promise<PumpfunInitialCoinData> {
    let initialCoinData = await pumpfunRepository.getToken(mint);

    if (!initialCoinData) {
        initialCoinData = pumpCoinDataToInitialCoinData(
            await pumpfun.getCoinDataWithRetries(mint, {
                maxRetries: 10,
                sleepMs: retryCount => (retryCount <= 5 ? 250 : 500),
            }),
        );
        await pumpfunRepository.insertToken(initialCoinData);
    }

    return initialCoinData;
}

export function calculatePumpTokenLamportsValue(amountRaw: number, priceInSol: number): number {
    return solToLamports(priceInSol * (amountRaw / 10 ** PUMPFUN_TOKEN_DECIMALS));
}

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
        const bondingCurve = await pumpfun.getBondingCurveAddress(mintAddress);
        const associatedBondingCurve = await pumpfun.getAssociatedBondingCurveAddress(bondingCurve, mintAddress);

        const sellRes = (await measureExecutionTime(
            () =>
                pumpfun.sell({
                    transactionMode: TransactionMode.Execution,
                    payerPrivateKey: wallet.privateKey,
                    tokenMint: token.mint,
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
    retryConfig: {
        maxRetries: number;
        sleepMs: number | ((retryCount: number) => number);
    };
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
