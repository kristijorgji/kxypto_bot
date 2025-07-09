export type ExtendedRequest = {
    jwtPayload?: {
        userId: string;
    };
};

export type CursorPaginatedResponse<T> = {
    data: T[];
    count: number;
    nextCursor?: string | null;
};
