import { Knex } from 'knex';

import CompositeCursor from '@src/db/utils/CompositeCursor';

import { Tables } from '../tables';

export const scopedColumn = (table: (typeof Tables)[keyof typeof Tables], column: string): string =>
    `${table}.${column}`;

/**
 * Applies a composite cursor filter to a Knex query builder to paginate by
 * (created_at, id) tuple in ascending order.
 */
export function applyCompositeCursorFilter(
    query: Knex.QueryBuilder,
    cursor: CompositeCursor,
    prefix = '',
    direction: 'asc' | 'desc',
): void {
    if (!cursor) {
        return;
    }

    const lastDate = cursor.lastDate;
    const lastPreviousId = Number(cursor.lastPreviousId);
    if (Number.isNaN(lastPreviousId)) {
        throw new Error('lastPreviousId in cursor must be a number.');
    }

    const p = prefix ? `${prefix}.` : '';

    if (direction === 'asc') {
        query.andWhere(function () {
            this.where(`${p}created_at`, '>', lastDate).orWhere(function () {
                this.where(`${p}created_at`, '=', lastDate).andWhere(`${p}id`, '>', lastPreviousId);
            });
        });
    } else {
        query.andWhere(function () {
            this.where(`${p}created_at`, '<', lastDate).orWhere(function () {
                this.where(`${p}created_at`, '=', lastDate).andWhere(`${p}id`, '<', lastPreviousId);
            });
        });
    }
}
