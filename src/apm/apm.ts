/* eslint-disable @typescript-eslint/no-explicit-any */

import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/knex';
import { Tables } from '../db/tables';
import { ApmEntry } from '../db/types';
import { logger } from '../logger';

const batched: ApmEntry[] = [];
const batchSize = 1000;

export function startApm(): void {
    process.on('SIGINT', async () => {
        try {
            logger.debug('APM - Graceful shutdown');
            logger.debug(`APM - Will insert ${batched.length} entries`);
            /** '
             * TODO Fix this because it is not being awaited
             * https://stackoverflow.com/questions/79433138/how-to-run-async-operation-and-wait-before-node-process-ends
             */
            await insertExecutionTimes(batched);
            logger.debug('APM - Execution times inserted successfully');
        } catch (error) {
            logger.error('APM - Error inserting apm entries: %o', error);
        } finally {
            process.exit(0);
        }
    });

    setInterval(async () => {
        if (batched.length >= batchSize) {
            await insertExecutionTimes(batched.splice(0, batchSize));
        }
    }, 250);
}

export async function measureExecutionTime<T>(
    fn: () => Promise<T>,
    functionName: string,
    config?: {
        storeImmediately: boolean;
    },
): Promise<T> {
    const start = process.hrtime();
    const unixTimestampInMs = Date.now();

    const result = await fn();

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    const apmEntry: ApmEntry = {
        id: uuidv4(),
        name: functionName,
        start_timestamp_ms: unixTimestampInMs,
        execution_time_ns: timeInNs,
    };

    if (config?.storeImmediately === true) {
        await db.table(Tables.Apm).insert(apmEntry);
    } else {
        batched.push(apmEntry);
    }

    return result;
}

async function insertExecutionTimes(data: ApmEntry[]): Promise<void> {
    const trx = await db.transaction();

    try {
        await trx.batchInsert(Tables.Apm, data);
        await trx.commit();
        logger.debug(`APM - Inserted ${data.length} records successfully`);
    } catch (error) {
        await trx.rollback();
        logger.error('APM - Error inserting execution times %o', error);
    }
}
