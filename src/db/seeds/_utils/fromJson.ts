import fs from 'fs';
import path from 'path';

import { Knex } from 'knex';

export const seedCommonFromJson = async (knex: Knex, tableName: string): Promise<void> => {
    await knex(tableName).insert(JSON.parse(resolveJsonFileForEnv(undefined, tableName)));
};

export const seedFromJsonForCurrentEnv = async (knex: Knex, tableName: string): Promise<void> => {
    const filePath = resolveJsonFileForEnv(process.env.APP_ENV, tableName);

    if (!fs.existsSync(filePath)) {
        console.log(`Skipping seed file for current env as it does not exist ${filePath}`);
        return;
    }

    const payload = JSON.parse(fs.readFileSync(filePath).toString());

    await knex(tableName).insert(payload);
};

function resolveJsonFileForEnv(env: string | undefined, tableName: string): string {
    return path.resolve(__dirname, `../data/${env ?? ''}/${tableName}.json`);
}
