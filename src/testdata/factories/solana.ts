import { faker } from '@faker-js/faker';

export function randomPriceSol(): number {
    return faker.number.float({
        min: 3.2e-8,
        max: 7e-7,
    });
}
