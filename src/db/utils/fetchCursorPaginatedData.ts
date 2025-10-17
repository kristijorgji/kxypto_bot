import { CompositeCursorPaginationParams } from '@src/db/repositories/types';
import CompositeCursor from '@src/db/utils/CompositeCursor';
import { CursorFactory } from '@src/db/utils/CursorFactory';
import { CursorPaginatedResponse } from '@src/http-api/types';
import { Pagination, PlainFilters } from '@src/types/data';
import { formatDateToMySQLTimestamp } from '@src/utils/time';

export default async function fetchCursorPaginatedData<
    R extends {
        id: string | number;
        created_at: Date | string;
    },
    F extends PlainFilters,
>(
    fetcher: (pagination: CompositeCursorPaginationParams, filters: F) => Promise<R[]>,
    pagination: Pagination,
    filters: F,
): Promise<CursorPaginatedResponse<R>> {
    let decodedCursor: CompositeCursor | undefined;
    if (pagination.cursor) {
        decodedCursor = CursorFactory.decodeCursor(pagination.cursor);
    }

    const data = await fetcher(
        {
            direction: pagination.direction ?? 'desc',
            limit: pagination.limit + 1,
            cursor: decodedCursor,
        },
        filters,
    );

    let nextCursor: string | null = null;
    if (data.length > pagination.limit) {
        const lastItem = data[pagination.limit - 1];
        const createdAt: Date =
            typeof lastItem.created_at === 'string' ? new Date(lastItem.created_at) : lastItem.created_at;
        nextCursor = CursorFactory.formCursor({
            lastPreviousId: lastItem.id.toString(),
            lastDate: formatDateToMySQLTimestamp(createdAt, true),
        });
        data.pop();
    }

    return {
        data: data,
        count: data.length,
        nextCursor: nextCursor,
    };
}
