import { PumpFunCoinData, PumpfunInitialCoinData } from '../types';

export function pumpCoinDataToInitialCoinData(coinData: PumpFunCoinData): PumpfunInitialCoinData {
    return {
        mint: coinData.mint,
        creator: coinData.creator,
        createdTimestamp: coinData.created_timestamp,
        bondingCurve: coinData.bonding_curve,
        associatedBondingCurve: coinData.associated_bonding_curve,
        name: coinData.name,
        symbol: coinData.symbol,
        description: coinData.description,
        image: coinData.image_uri,
        twitter: coinData.twitter,
        telegram: coinData.telegram,
        website: coinData.website,
    };
}
