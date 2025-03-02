import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.StrategyResults, table => {
        table.uuid('backtest_id');
        table.string('strategy').notNullable();
        table.string('config_variant');
        table.json('config').notNullable();
        table.double('pln_sol').notNullable();
        table.double('holdings_value_sol').notNullable();
        table.float('roi').notNullable().index();
        table.float('win_rate').notNullable().index();
        table.integer('wins_count').unsigned().notNullable();
        table.float('biggest_win_percentage').notNullable();
        table.integer('losses_count').unsigned().notNullable();
        table.float('biggest_loss_percentage').notNullable();
        table.integer('total_trades_count').unsigned().notNullable();
        table.integer('buy_trades_count').unsigned().notNullable();
        table.integer('sell_trades_count').unsigned().notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.foreign('backtest_id').references('id').inTable(Tables.Backtests);
        table.unique(['backtest_id', 'strategy', 'config_variant']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.StrategyResults);
}
