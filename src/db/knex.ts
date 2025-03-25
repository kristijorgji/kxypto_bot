import { Knex, knex } from 'knex';

function createKnex(): Knex {
    return knex({
        client: 'mysql2',
        connection: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT as string),
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            timezone: '+00:00',
        },
    });
}

/**
 * Singleton instance of the DB Connection.
 */
export const db = createKnex();
