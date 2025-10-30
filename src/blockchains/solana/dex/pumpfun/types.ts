import { PumpfunPositionMeta } from '@src/trading/bots/blockchains/solana/types';

import { SolFullTransactionDetails } from '../../types';

export type NewPumpFunTokenData = {
    name: string;
    symbol: string;
    uri: string;
    mint: string;
    bondingCurve: string;
    user: string;
};

export type PumpfunTokenBcStats = {
    marketCapInSol: number;
    priceInSol: number;
    bondingCurveProgress: number;
    virtualSolReserves: number;
    virtualTokenReserves: number;
};

export type PumpfunInitialCoinData = {
    mint: string;
    creator: string;
    createdTimestamp: number;
    bondingCurve: string;
    associatedBondingCurve: string;
    name: string;
    symbol: string;
    description: string;
    image: string;
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
};

export type PumpFunCoinData = {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    image_uri: string;
    video_uri: string | null;
    metadata_uri: string;
    twitter: string | null;
    telegram: string | null;
    bonding_curve: string;
    associated_bonding_curve: string;
    creator: string;
    created_timestamp: number;
    raydium_pool: null;
    complete: false;
    virtual_sol_reserves: number;
    virtual_token_reserves: number;
    total_supply: number;
    website: string | null;
    show_name: true;
    king_of_the_hill_timestamp: null;
    market_cap: number;
    reply_count: number;
    last_reply: number;
    nsfw: false;
    market_id: string | null;
    inverted: string | null;
    is_currently_live: boolean;
    username: string | null;
    profile_image: string | null;
    usd_market_cap: number;
};

export type PumpfunTransactionErrorType =
    | 'pumpfun_slippage_more_sol_required'
    | 'insufficient_lamports'
    | 'unknown'
    | 'pump_sell_not_enough_tokens';

export type SolPumpfunTransactionDetails = Omit<SolFullTransactionDetails, 'fullTransaction' | 'error'> & {
    error?: {
        type: PumpfunTransactionErrorType;
        object: unknown;
    };
};

export type PumpfunBuyResponse = {
    signature: string;
    boughtAmountRaw: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
    actualBuyPriceSol: number;
    txDetails: SolPumpfunTransactionDetails;
    metadata: PumpfunPositionMeta;
};

export type PumpfunSellResponse = {
    signature: string;
    soldRawAmount: number;
    minLamportsOutput: number;
    actualSellPriceSol: number;
    txDetails: SolPumpfunTransactionDetails;
    metadata: PumpfunPositionMeta;
};

export interface PumpfunListener {
    listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => Promise<void>): Promise<void>;

    stopListeningToNewTokens(): void;
}
