import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Users, table => {
        table.uuid('id').primary();
        table.string('name', 50).nullable();
        table.string('email').notNullable().unique();
        table.string('username').notNullable();
        table.string('password').notNullable();
        table.timestamps(true, true);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Users);
}
