import { Knex, knex } from 'knex';

export function createKnex(): Knex {
    return knex({
        client: 'mysql2',
        connection: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT as string),
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        },
    });
}
