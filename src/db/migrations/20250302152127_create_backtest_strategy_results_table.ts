import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addTableTimestamps } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.BacktestStrategyResults, table => {
        table.bigIncrements('id').primary();
        table.uuid('backtest_id').notNullable();
        table
            .bigint('backtest_run_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable(Tables.BacktestRuns)
            .onDelete('CASCADE')
            .index();
        table.enum('status', ['pending', 'running', 'completed', 'failed', 'aborted']).notNullable().index();
        table.string('strategy').notNullable();
        table.string('strategy_id').notNullable();
        table.string('config_variant', 300).notNullable();
        table.json('config').notNullable();
        table.double('pnl_sol').notNullable().index();
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
        table.double('highest_peak_sol').notNullable();
        table.double('lowest_trough_sol').notNullable();
        table.float('max_drawdown_percentage').notNullable();
        table.decimal('execution_time_seconds', 10, 3).notNullable();
        addTableTimestamps(knex, table);

        table.foreign('backtest_id').references('id').inTable(Tables.Backtests);
        table.unique(['backtest_id', 'strategy', 'config_variant'], {
            indexName: 'bt_strategy_res_bt_id_strategy_config_variant_unique',
        });
        table.unique(['backtest_id', 'strategy_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.BacktestStrategyResults);
}
