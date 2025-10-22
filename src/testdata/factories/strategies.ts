import { faker } from '@faker-js/faker';

import { fakeMint } from '@src/testdata/factories/pumpfun';
import { PredictionRequest } from '@src/trading/strategies/types';
import { randomInt } from '@src/utils/data/data';

export function PredictionRequestFactory(
    copy?: {
        mint?: string;
    },
    numberOfFeatures?: number,
): PredictionRequest {
    numberOfFeatures = numberOfFeatures ?? randomInt(1, 7);
    return {
        mint: copy?.mint ?? fakeMint(),
        features: Array.from({ length: numberOfFeatures }).map(PredictionRequestFeatureFactory),
    };
}

function PredictionRequestFeatureFactory(): PredictionRequest['features'][number] {
    return {
        timestamp: faker.date.past().valueOf(),
        timeFromStartMs: faker.date.past().valueOf(),
        price: faker.number.float(),
        marketCap: faker.number.float(),
        bondingCurveProgress: faker.number.int({ min: 1, max: 100 }),
        holdersCount: faker.number.float(),
        devHoldingPercentage: faker.number.float({ min: 1, max: 100 }),
        topTenHoldingPercentage: faker.number.float({ min: 1, max: 100 }),
        devHoldingPercentageCirculating: faker.number.float({ min: 1, max: 100 }),
        topTenHoldingPercentageCirculating: faker.number.float({ min: 1, max: 100 }),
        topHolderCirculatingPercentage: faker.number.float({ min: 1, max: 100 }),
    };
}
