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

export type MeUser = {
    id: string;
    name: string;
    email: string;
    config: {
        permissions: string[];
    };
};

export type OtherUser = {
    id: string;
    name: string;
    username: string;
};
