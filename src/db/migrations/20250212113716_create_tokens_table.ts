import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Tokens, table => {
        table.string('mint').primary();
        table.string('createdOn').notNullable();
        table.timestamp('token_created_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Tokens);
}
