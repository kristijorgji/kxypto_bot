import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addTableTimestamps } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.LaunchpadTokenResults, table => {
        table.bigIncrements('id').primary();
        table.boolean('simulation').notNullable();
        table.enum('chain', ['solana']).notNullable().index();
        table.enum('platform', ['pumpfun']).notNullable().index();
        table.string('mint').notNullable();
        table.string('creator').notNullable().index();
        table.decimal('net_pnl', 38, 18).nullable();
        table.enum('exit_code', ['NO_PUMP', 'DUMPED', 'STOPPED', 'BAD_CREATOR']).nullable().index();
        table.string('exit_reason').nullable();
        addTableTimestamps(knex, table);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.LaunchpadTokenResults);
}
