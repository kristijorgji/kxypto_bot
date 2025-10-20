import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addCreatedAtTimestamp } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Apm, table => {
        table.uuid('id').primary();
        table.string('name').notNullable().index();
        table.string('provider').notNullable().index();
        table.bigint('start_timestamp_ms').notNullable();
        table.double('execution_time_ns').notNullable();
        addCreatedAtTimestamp(knex, table);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Apm);
}
