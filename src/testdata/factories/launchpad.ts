import { faker } from '@faker-js/faker';

import { randomPriceSol } from '@src/testdata/factories/solana';
import { HistoryEntry, MarketContext } from '@src/trading/bots/launchpads/types';

export function HistoryEntryFactory(copy?: Partial<HistoryEntry>): HistoryEntry {
    const priceSol = copy?.price ?? randomPriceSol();

    return {
        timestamp: copy?.timestamp ?? faker.date.past().getTime(),
        price: priceSol,
        marketCap: copy?.marketCap ?? priceSol * faker.number.int({ min: 1e3, max: 1e8 }),
        bondingCurveProgress: copy?.bondingCurveProgress ?? faker.number.int({ min: 1, max: 100 }),
        holdersCount: copy?.holdersCount ?? faker.number.int({ min: 1, max: 1e3 }),
        devHoldingPercentage: copy?.devHoldingPercentage ?? faker.number.int({ min: 1, max: 100 }),
        topTenHoldingPercentage: copy?.topTenHoldingPercentage ?? faker.number.int({ min: 1, max: 100 }),
        devHoldingPercentageCirculating:
            copy?.devHoldingPercentageCirculating ?? faker.number.int({ min: 1, max: 100 }),
        topTenHoldingPercentageCirculating:
            copy?.topTenHoldingPercentageCirculating ?? faker.number.int({ min: 1, max: 100 }),
        topHolderCirculatingPercentage: copy?.topHolderCirculatingPercentage ?? faker.number.int({ min: 1, max: 100 }),
    };
}

export function NewMarketContextFactory(copy?: Partial<MarketContext>): MarketContext {
    return {
        price: copy?.price ?? faker.number.float(),
        marketCap: copy?.marketCap ?? faker.number.float(),
        bondingCurveProgress: copy?.bondingCurveProgress ?? faker.number.int({ min: 0, max: 100 }),
        holdersCount: copy?.holdersCount ?? faker.number.int(),
        devHoldingPercentage: copy?.devHoldingPercentage ?? faker.number.int({ min: 0, max: 100 }),
        topTenHoldingPercentage: copy?.topTenHoldingPercentage ?? faker.number.int({ min: 0, max: 100 }),
        devHoldingPercentageCirculating:
            copy?.devHoldingPercentageCirculating ?? faker.number.int({ min: 0, max: 100 }),
        topTenHoldingPercentageCirculating:
            copy?.topTenHoldingPercentageCirculating ?? faker.number.int({ min: 0, max: 100 }),
        topHolderCirculatingPercentage: copy?.topHolderCirculatingPercentage ?? faker.number.int({ min: 0, max: 100 }),
    };
}
