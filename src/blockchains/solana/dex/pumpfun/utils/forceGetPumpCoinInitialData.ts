import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { pumpCoinDataToInitialCoinData } from '@src/blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '@src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '@src/blockchains/solana/dex/pumpfun/types';
import PumpfunRepository, { pumpfunRepository } from '@src/db/repositories/PumpfunRepository';

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
    _repository: PumpfunRepository,
    mint: string,
): Promise<PumpfunInitialCoinData> {
    let initialCoinData = await pumpfunRepository.getToken(mint);

    if (!initialCoinData) {
        initialCoinData = pumpCoinDataToInitialCoinData(
            await pumpfun.getCoinDataWithRetries(mint, {
                maxRetries: 10,
                sleepMs: retryCount => (retryCount <= 5 ? 250 : 500),
            }),
            {
                tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
            },
        );
        await pumpfunRepository.insertToken(initialCoinData);
    }

    return initialCoinData;
}
