import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Tokens, table => {
        table.enum('chain', ['solana']).index();
        table.string('mint').notNullable().index();
        table.string('name').notNullable();
        table.string('symbol').notNullable();
        table.json('other').nullable();
        table.string('createdOn').notNullable().index();
        table.timestamp('token_created_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.primary(['chain', 'mint']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Tokens);
}
