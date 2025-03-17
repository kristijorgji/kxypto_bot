import type { Knex } from 'knex';

import { Tables } from '../tables';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.Positions, table => {
        table.bigIncrements('id').primary();
        table.string('trade_id', 50).unique().notNullable();
        table.enum('chain', ['solana']).notNullable().index();
        table.string('exchange', 50).notNullable().index();
        table.string('user_address').notNullable().index();
        table.string('asset_mint').notNullable();
        table.string('asset_name').notNullable();
        table.string('asset_symbol').notNullable();
        table.decimal('entry_price', 38, 18).notNullable();
        table.decimal('in_amount', 38, 18).notNullable();
        table.decimal('stop_loss', 38, 18).nullable();
        table.decimal('trailing_sl_percent', 5, 2).nullable();
        table.decimal('take_profit', 38, 18).nullable();
        table.decimal('trailing_take_profit_percent', 7, 2).nullable();
        table.decimal('trailing_take_profit_stop_percent', 7, 2).nullable();
        table.string('tx_signature').notNullable();
        table.enum('status', ['open', 'closed']).notNullable().defaultTo('open').index();
        table.timestamp('opened_at').defaultTo(knex.fn.now());
        table.timestamp('closed_at').nullable();
        table
            .enum('close_reason', [
                'DUMPED',
                'TRAILING_STOP_LOSS',
                'STOP_LOSS',
                'TAKE_PROFIT',
                'TRAILING_TAKE_PROFIT',
                'AT_HARDCODED_PROFIT',
                'NO_LONGER_MEETS_ENTRY_RULES',
            ])
            .nullable()
            .index();
        table.string('exit_tx_signature').nullable();
        table.decimal('exit_price', 38, 18).nullable();
        table.decimal('realized_profit', 38, 18).nullable();
        table.decimal('exit_amount', 38, 18).nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.Positions);
}
