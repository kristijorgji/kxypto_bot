import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addTableTimestamps } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.LaunchpadTokenReports, table => {
        table.bigIncrements('id').primary();
        table.bigint('launchpad_token_result_id').unsigned();
        table.decimal('schema_version', 7, 3).notNullable().index();
        table.jsonb('report').notNullable();
        addTableTimestamps(knex, table);

        table
            .foreign('launchpad_token_result_id')
            .references('id')
            .inTable(Tables.LaunchpadTokenResults)
            .onDelete('CASCADE');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.LaunchpadTokenReports);
}
