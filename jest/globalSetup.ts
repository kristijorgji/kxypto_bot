// eslint-disable-next-line import/order
import dotenv from 'dotenv';
/**
 * This must always be first before importing modules that use the process.env
 */
dotenv.config({ path: '.env.test' });

import { knex } from 'knex';

import { getTestDbName } from './testdb-utils';
// @ts-ignore
import knexConfig from '../knexfile';
import { isRunningIntegrationTests } from './env-utils';
import { db } from '../src/db/knex';

export default async () => {
    if (isRunningIntegrationTests()) {
        await setupIntegrationTests();
    }
};

async function setupIntegrationTests(): Promise<void> {
    const testDatabaseName = getTestDbName();
    console.log(`[globalSetup.integration] - creating and migrating database ${testDatabaseName}`);

    try {
        /**
         * We need a connection to create the database
         * Using the existing db will fail because it assumes the DB exists already
         */
        const connectionWithoutDb = {
            ...knexConfig.connection,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        };
        delete connectionWithoutDb.database;
        const bootstrapKnex = knex({
            ...knexConfig,
            connection: connectionWithoutDb,
        });
        await bootstrapKnex.raw(`CREATE DATABASE IF NOT EXISTS ${testDatabaseName}`);
        await bootstrapKnex.destroy();

        await db.migrate.latest();
        await db.seed.run();
    } catch (e) {
        console.error(e);
        throw e;
    }
}
