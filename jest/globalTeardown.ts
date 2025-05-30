import { isRunningIntegrationTests } from './env-utils';
import { getTestDbName } from './testdb-utils';
import { db } from '../src/db/knex';

export default async () => {
    if (isRunningIntegrationTests()) {
        await teardownIntegrationTests();
    }
};

async function teardownIntegrationTests(): Promise<void> {
    const testDatabaseName = getTestDbName();
    console.log(`[globalTeardown.integration] - destroying test database ${testDatabaseName}`);

    try {
        await db.raw(`DROP DATABASE IF EXISTS ${testDatabaseName}`);
        await db.destroy();
    } catch (e) {
        console.error(e);
        throw e;
    }
}
