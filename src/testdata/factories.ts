import { faker } from '@faker-js/faker';

import { NewPumpFunTokenData } from '../blockchains/solana/dex/pumpfun/types';
import { trimEllip } from '../utils/text';

export const NewPumpFunTokenDataFactory = (): NewPumpFunTokenData => {
    const p = faker.animal.petName();

    return {
        name: p,
        symbol: trimEllip(p, 3),
        uri: faker.internet.url(),
        mint: faker.string.alpha(44),
        bondingCurve: faker.string.alpha(44),
        user: faker.string.alpha(44),
    };
};
