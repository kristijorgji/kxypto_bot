import dotenv from 'dotenv';
import type { Knex } from 'knex';

dotenv.config();

const config: Knex.Config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT as string),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    },
    migrations: {
        directory: './src/db/migrations',
        tableName: 'knex_migrations',
    },
    seeds: {
        directory: './src/db/seeds',
    },
};

module.exports = config;
