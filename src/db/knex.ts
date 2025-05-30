import { Knex, knex } from 'knex';

// @ts-ignore
import knexConfig from '../../knexfile';

function createKnex(): Knex {
    return knex(knexConfig);
}

/**
 * Singleton instance of the DB Connection.
 */
export const db = createKnex();
