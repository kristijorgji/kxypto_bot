import type { Knex } from 'knex';

import { Tables } from '../tables';
import { addTableTimestamps } from '../utils/tableTimestamps';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable(Tables.BacktestRuns, table => {
        table.bigIncrements('id').primary();
        table.uuid('backtest_id').notNullable().references('id').inTable(Tables.Backtests).onDelete('CASCADE').index();
        table
            .enum('source', ['api_client', 'cli', 'app', 'system'])
            .notNullable()
            .index()
            .comment(
                [
                    'api_client = triggered via API key/client',
                    'cli = any logged-in CLI run (requires user authentication)',
                    'app = any logged-in UI: web, mobile, desktop app',
                    'system = automated/scheduled system run, no user involved',
                ].join('\n'),
            );
        table.enum('status', ['pending', 'running', 'completed', 'failed', 'aborted']).notNullable().index();
        table
            .uuid('user_id')
            .nullable()
            .comment(
                [
                    'ID of the User that made the change.',
                    'Present only if the change was made after logging-in, sources "cli" or "app".',
                    'App can be web, mobile or anything that requires log-in flow',
                ].join('\n'),
            )
            .references('id')
            .inTable(Tables.Users)
            .index();
        table
            .uuid('api_client_id')
            .nullable()
            .comment('ID of the API Client that made the change.Present only if source is api_client.');
        table.timestamp('started_at', { useTz: true });
        table.timestamp('finished_at', { useTz: true });
        table.json('config').notNullable();
        table
            .bigInteger('total_iterations')
            .unsigned()
            .notNullable()
            .comment('Total number of strategies/iterations to be processed.');
        table
            .integer('total_permutations')
            .unsigned()
            .notNullable()
            .comment('Total combined permutations, total of all iteration permutations (the "real" total work).');
        table.json('checkpoint').nullable();
        table.json('failure_details').nullable();
        addTableTimestamps(knex, table);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(Tables.BacktestRuns);
}
