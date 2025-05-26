import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Backtests, table => {
        table.uuid('id').primary();
        table.string('name').nullable();
        table.json('config').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Backtests);
}
