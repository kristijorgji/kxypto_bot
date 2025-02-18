import { SolTransactionDetails } from '../../types';

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
    // TODO find a way to fetch these 2 below natively via Pumpfun.getInitialCoinBaseData
    creator?: string;
    createdTimestamp?: number;
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

export type PumpfunBuyResponse = {
    signature: string;
    boughtAmountRaw: number;
    pumpTokenOut: number;
    pumpMaxSolCost: number;
    txDetails: SolTransactionDetails;
};

export type PumpfunSellResponse = {
    signature: string;
    soldRawAmount: number;
    minLamportsOutput: number;
    txDetails: SolTransactionDetails;
};

export interface PumpfunListener {
    listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void): Promise<void>;

    stopListeningToNewTokens(): void;
}
