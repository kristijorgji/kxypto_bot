/* eslint-disable @typescript-eslint/no-explicit-any */

import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/knex';
import { Tables } from '../db/tables';
import { ApmEntry } from '../db/types';

const batched: ApmEntry[] = [];
const batchSize = 1000;

export function startApm(): void {
    process.on('SIGINT', async () => {
        try {
            console.log('APM - Graceful shutdown');
            console.log(`APM - Will insert ${batched.length} entries`);
            /** '
             * TODO Fix this because it is not being awaited
             * https://stackoverflow.com/questions/79433138/how-to-run-async-operation-and-wait-before-node-process-ends
             */
            await insertExecutionTimes(batched);
            console.log('APM - Execution times inserted successfully');
        } catch (error) {
            console.error('APM - Error inserting apm entries:', error);
        } finally {
            process.exit(0);
        }
    });

    setInterval(async () => {
        if (batched.length >= batchSize) {
            // console.log(`APM - Storing batch of ${batchSize}, total length ${batched.length}`);
            await insertExecutionTimes(batched.splice(0, batchSize));
            // console.log('APM - batched length after', batched.length);
        }
    }, 250);
}

export async function measureExecutionTime<T>(
    fn: () => T,
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
        console.log(`APM - Inserted ${data.length} records successfully`);
    } catch (error) {
        await trx.rollback();
        console.error('APM - Error inserting execution times', error);
    }
}
