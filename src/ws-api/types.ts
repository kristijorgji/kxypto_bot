import { WebSocket } from 'ws';

import { CursorPaginatedResponse } from '@src/http-api/types';
import { PlainFilters } from '@src/types/data';

/**
 * Represents a single active subscription for a WebSocket client.
 * Stores context for managing updates, filters, and pagination.
 */
export interface SubscriptionContext {
    /**
     * Unique identifier for this subscription, provided by the client.
     * Used to match responses, fetchMore requests, and unsubscribe actions.
     */
    id: string;

    /**
     * Logical channel of the subscription.
     * Examples: "backtestsMintResults", "trades".
     */
    channel: string;

    /**
     * Applied filters used for this subscription.
     * Helps identify which items belong to this subscription.
     */
    filters?: PlainFilters;

    /**
     * Cursor for pagination. Indicates the last item received.
     * Used when fetching the next page of data with fetchMore events.
     */
    cursor?: string | null;

    /**
     * Number of items to include per fetch/page.
     */
    limit?: number;

    /**
     * Optional interval reference for live updates (used in mock/debug mode).
     * Cleared when unsubscribing or disconnecting.
     */
    interval?: ReturnType<typeof setInterval>;
}

/**
 * Payload attached to each authenticated WebSocket client.
 */
export interface WsUserPayload {
    /**
     * Unique user identifier
     */
    userId: string;

    /**
     * Additional optional fields added by authentication middleware
     */
    [key: string]: unknown;
}

/**
 * Extends WebSocket with additional server-side properties.
 */
export interface WsConnection extends WebSocket {
    /**
     * Authenticated user info
     */
    user: WsUserPayload;

    /**
     * Enable JSON debug mode for easy testing
     */
    debugMode: boolean;

    /**
     * Active subscriptions for this client
     */
    subscriptions: Map<string, SubscriptionContext>;
}

/**
 * Generic structure for request data including filters and pagination.
 */
export type RequestDataParams<TFilters = PlainFilters> = {
    /**
     * Filters applied by the client
     */
    filters: TFilters;

    /**
     * Pagination details
     */
    pagination: {
        /**
         * Cursor for the last item received
         */
        cursor?: string;

        /**
         * Number of items per fetch/page
         */
        limit: number;
    };
};

/**
 * Possible client event types
 */
export type InputEventType = 'subscribe' | 'fetchMore' | 'unsubscribe';

/**
 * Base structure for all incoming WebSocket messages from the client.
 */
export interface BaseMessage {
    /**
     * Unique subscription ID generated and provided by the client.
     * Used to identify the subscription for fetchMore, unsubscribe, or updates.
     */
    id: string;

    /**
     * The logical channel this message relates to.
     * Examples: "backtestsMintResults", "trades".
     */
    channel: string;

    /**
     * Type of action the client wants to perform.
     * Typical values: "subscribe", "unsubscribe", "fetchMore", etc.
     */
    event: InputEventType;
}

/**
 * Subscribe message sent by client
 */
export interface SubscribeMessage extends BaseMessage {
    event: 'subscribe';
    /**
     * Request data containing filters and pagination
     */
    data: RequestDataParams;
}

/**
 * Fetch more paginated data message sent by client
 */
export interface FetchMoreMessage extends BaseMessage {
    event: 'fetchMore';
    /**
     * Cursor and limit for fetching additional data
     */
    data: {
        cursor: string;
        limit?: number;
    };
}

/**
 * Unsubscribe message sent by client
 */
export interface UnsubscribeMessage extends BaseMessage {
    event: 'unsubscribe';
}

/**
 * Union of all client message types
 */
export type WsMessage = SubscribeMessage | FetchMoreMessage | UnsubscribeMessage;

/**
 * Server response event types
 */
export type ResponseEventType = 'snapshot' | 'fetchMore' | 'update';

/**
 * Base structure for all server responses
 */
export interface BaseResponse<T extends ResponseEventType = ResponseEventType> {
    /**
     * Unique subscription ID generated and provided by the client.
     * Used to identify the subscription for fetchMore, unsubscribe, or updates.
     */
    id: string;

    /**
     * The logical channel this message relates to.
     * Examples: "backtestsMintResults", "trades".
     */
    channel: string;

    /**
     * Type of the server response.
     * Indicates what kind of data is included in this message:
     * - "snapshot": initial data sent when the subscription is created
     * - "fetchMore": additional paginated data requested by the client
     * - "update": incremental updates to existing data
     */
    event: T;
}

/**
 * Response containing initial snapshot of data for a subscription
 */
export interface DataSubscriptionResponse<T> extends BaseResponse {
    event: 'snapshot';

    /**
     * Initial batch of data
     */
    snapshot: {
        /**
         * Data
         */
        data: T;

        /**
         * Filters applied for this subscription (optional)
         */
        appliedFilters?: PlainFilters;
    };
}

/**
 * Response containing additional paginated data for a subscription.
 */
export interface DataFetchMoreResponse<T> extends BaseResponse {
    /**
     * Event type is "fetchMore" to distinguish from snapshot and update
     */
    event: 'fetchMore';

    payload: {
        /**
         * Items returned
         */
        paginatedData: CursorPaginatedResponse<T>;

        /**
         * Filters applied for this subscription (optional)
         */
        appliedFilters?: PlainFilters;
    };
}

type UpdateAction = 'added' | 'updated' | 'deleted';

export type UpdateItem<T = unknown> = {
    id: string;
    action: UpdateAction;
} & (
    | {
          action: 'added';
          data: T;
          version?: number;
      }
    | {
          action: 'updated';
          data: T;
          /**
           * Optional, for diff/undo
           */
          previousData?: Partial<T>;
          version: number;
      }
    | {
          action: 'deleted';
      }
);

export type UpdatesPayload<T> = {
    /**
     * Updated items (single or batch)
     */
    items: UpdateItem<T>[];

    /**
     * Filters applied for this subscription (optional)
     */
    appliedFilters?: PlainFilters;
};

/**
 * Response containing incremental updates for a subscription
 */
export interface DataUpdateResponse<T> extends BaseResponse {
    event: 'update';
    updates: UpdatesPayload<T>;
}

export type WsServerResponse<T> = DataSubscriptionResponse<T> | DataUpdateResponse<T> | DataFetchMoreResponse<T>;
