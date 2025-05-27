import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.BacktestStrategyMintResults, table => {
        table.bigIncrements('id').primary();
        table.bigint('strategy_result_id').unsigned();
        table.string('mint').notNullable();
        table.enum('mint_file_storage_type', ['local', 's3']).notNullable();
        table.string('mint_file_path').notNullable();
        table.decimal('net_pnl_sol', 38, 18).nullable();
        table.decimal('holdings_value_sol', 38, 18).nullable();
        table.float('roi').nullable();
        table.enum('exit_code', ['NO_PUMP', 'DUMPED', 'STOPPED', 'BAD_CREATOR']).nullable().index();
        table.string('exit_reason').nullable();
        table.jsonb('payload').notNullable();
        table.integer('total_trades_count').unsigned().notNullable().index();
        table.integer('buy_trades_count').unsigned().notNullable();
        table.integer('sell_trades_count').unsigned().notNullable();
        table.timestamps(true, true);

        table.foreign('strategy_result_id').references('id').inTable(Tables.BacktestStrategyResults);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.BacktestStrategyMintResults);
}
