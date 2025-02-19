import { PUMPFUN_TOKEN_DECIMALS } from './constants';
import { pumpCoinDataToInitialCoinData } from './mappers/mappers';
import Pumpfun from './Pumpfun';
import { PumpfunInitialCoinData } from './types';
import PumpfunRepository, { pumpfunRepository } from '../../../../db/repositories/PumpfunRepository';
import { solToLamports } from '../../../utils/amount';

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
