import { Knex } from 'knex';

export function addTableTimestamps(knex: Knex, table: Knex.CreateTableBuilder): void {
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')).notNullable();
}

export function addCreatedAtTimestamp(knex: Knex, table: Knex.CreateTableBuilder): void {
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
}
