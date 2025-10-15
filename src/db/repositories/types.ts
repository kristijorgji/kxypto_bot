import CompositeCursor from '@src/db/utils/CompositeCursor';

export type CursorPaginatedSearchParams = {
    direction: 'asc' | 'desc';
    limit: number;
    cursor?: CompositeCursor;
};
