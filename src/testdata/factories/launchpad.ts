import { faker } from '@faker-js/faker';

import { MarketContext } from '@src/trading/bots/launchpads/types';

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
