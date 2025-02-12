import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Apm, table => {
        table.uuid('id').primary();
        table.string('name').notNullable();
        table.bigint('start_timestamp_ms').notNullable();
        table.double('execution_time_ns').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Apm);
}
