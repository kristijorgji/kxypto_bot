import CompositeCursor from '@src/db/utils/CompositeCursor';

export type CompositeCursorPaginationParams = {
    /**
     * Pagination direction by date: ascending (oldest first) or descending (newest first).
     */
    direction: 'asc' | 'desc';

    /**
     * Maximum number of items to fetch in this page.
     */
    limit: number;

    /**
     * Optional cursor representing the last item received.
     * Used to fetch the next page of results.
     * This cursor is a CompositeCursor object encoding multiple pieces of information.
     */
    cursor?: CompositeCursor;
};
