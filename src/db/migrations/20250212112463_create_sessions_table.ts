import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addCreatedAtTimestamp } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Sessions, table => {
        table.uuid('id').primary();
        table.uuid('user_id').notNullable();
        table.string('refresh_token', 500).notNullable();
        table.string('user_agent', 255).notNullable();
        table.string('client_ip', 100).notNullable();
        table.enum('platform', ['web', 'android', 'ios']).notNullable();
        table.string('app_version', 100).notNullable();
        table.boolean('is_blocked').notNullable();
        table.integer('expires_at').unsigned().notNullable();
        addCreatedAtTimestamp(knex, table);

        table.foreign('user_id').references('id').inTable('users');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Sessions);
}
