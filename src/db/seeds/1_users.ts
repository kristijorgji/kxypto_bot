import { Knex } from 'knex';

import { Tables } from '../tables';
import { seedFromJsonForCurrentEnv } from './_utils/fromJson';

export async function seed(knex: Knex): Promise<void> {
    await seedFromJsonForCurrentEnv(knex, Tables.Users);
}
