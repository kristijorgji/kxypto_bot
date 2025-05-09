import { faker } from '@faker-js/faker';

import { NewPumpFunTokenData, PumpFunCoinData } from '../../blockchains/solana/dex/pumpfun/types';
import { trimEllip } from '../../utils/text';

export const NewPumpFunTokenDataFactory = (copy?: Partial<NewPumpFunTokenData>): NewPumpFunTokenData => {
    const p = faker.animal.petName();

    return {
        name: copy?.name ?? p,
        symbol: copy?.symbol ?? trimEllip(p, 3),
        uri: copy?.uri ?? faker.internet.url(),
        mint: copy?.mint ?? fakeMint(),
        bondingCurve: copy?.bondingCurve ?? faker.string.alpha(44),
        user: copy?.user ?? faker.string.alpha(44),
    };
};

export const NewPumpFunCoinDataFactory = (copy?: Partial<PumpFunCoinData>): PumpFunCoinData => {
    const p = faker.animal.petName();

    return {
        mint: copy?.mint ?? fakeMint(),
        name: copy?.name ?? p,
        symbol: copy?.symbol ?? trimEllip(p, 3),
        description: copy?.description ?? faker.lorem.paragraphs(),
        image_uri: copy?.image_uri ?? `https://ipfs.io/ipfs/${p}`,
        video_uri: copy?.video_uri ?? null,
        metadata_uri: copy?.metadata_uri ?? `https://ipfs.io/ipfs/${p}`,
        twitter: copy?.twitter ?? null,
        telegram: copy?.telegram ?? null,
        bonding_curve: copy?.bonding_curve ?? faker.string.uuid(),
        associated_bonding_curve: copy?.associated_bonding_curve ?? faker.string.uuid(),
        creator: copy?.creator ?? faker.string.uuid(),
        created_timestamp: copy?.created_timestamp ?? faker.date.past().getTime(),
        raydium_pool: copy?.raydium_pool ?? null,
        complete: copy?.complete ?? false,
        virtual_sol_reserves: copy?.virtual_sol_reserves ?? faker.number.int(),
        virtual_token_reserves: copy?.virtual_token_reserves ?? faker.number.int(),
        total_supply: copy?.total_supply ?? 1000000000000000,
        website: copy?.website ?? null,
        show_name: copy?.show_name ?? true,
        king_of_the_hill_timestamp: copy?.king_of_the_hill_timestamp ?? null,
        market_cap: copy?.market_cap ?? faker.number.float(),
        reply_count: copy?.reply_count ?? 9,
        last_reply: copy?.last_reply ?? faker.number.int(),
        nsfw: copy?.nsfw ?? false,
        market_id: copy?.market_id ?? null,
        inverted: copy?.inverted ?? null,
        is_currently_live: copy?.is_currently_live ?? false,
        username: copy?.username ?? null,
        profile_image: copy?.profile_image ?? null,
        usd_market_cap: copy?.usd_market_cap ?? faker.number.float(),
    };
};

function fakeMint(): string {
    return `f_${faker.string.alpha(42)}`;
}
