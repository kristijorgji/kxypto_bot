type PlainFilterValue = string | number | boolean | undefined;

export interface PlainFilters extends Record<string, PlainFilterValue | Array<PlainFilterValue>> {}

export type Pagination = {
    /**
     * Pagination direction by date: ascending (oldest first) or descending (newest first).
     */
    direction?: 'asc' | 'desc';

    /**
     * Maximum number of items to return in this page.
     */
    limit: number;

    /**
     * Cursor for the last item received.
     * Can be a string (often base64-encoded) representing a composite cursor
     * that encodes multiple pieces of information to continue pagination.
     * Optional: omit for the first page of results.
     */
    cursor?: string;
};
