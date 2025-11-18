import { Logger } from 'winston';
import { WebSocket } from 'ws';
import z from 'zod';

import { CursorPaginatedResponse } from '@src/http-api/types';
import { MessageFns, ProtoFetchStatus } from '@src/protos/generated/ws';
import PubSub from '@src/pubsub/PubSub';
import { Pagination, PlainFilters } from '@src/types/data';

export type SharedPluginDeps = {
    logger: Logger;
    pubsub: PubSub;
    pendingDistributedRpc: Record<string, (data: unknown) => void>;
};

export interface WsPlugin<
    TPluginDeps extends Record<string, unknown> = {},
    TSharedDeps extends Record<string, unknown> = {},
> {
    name: string;

    /**
     * SETUP PHASE
     * - shared deps provided
     * - plugin returns its own deps
     * - NO side effects (no subscriptions)
     */
    setup(shared: TSharedDeps): Promise<TPluginDeps> | TPluginDeps;

    /**
     * START PHASE
     * - receives final merged deps
     * - plugins can do all side effects:
     *   * PubSub subscribe
     *   * WS event handlers
     *   * timers
     *   * distributed RPC listeners
     */
    start?(deps: TSharedDeps & TPluginDeps & unknown): void | Promise<void>;
}

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

    /**
     * Optional callback to perform asynchronous resource cleanup.
     * * This should be called to ensure all open subscriptions, listeners,
     * intervals, event buses, and other external handles are properly closed.
     */
    close?: () => void | Promise<void>;
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
    pagination: Pagination;
};

/**
 * Possible client event types
 */
export const inputEventTypeSchema = z.enum(['subscribe', 'fetch', 'fetchMore', 'unsubscribe', 'rpc']);
export type InputEventType = z.infer<typeof inputEventTypeSchema>;

/**
 * Base structure for all incoming WebSocket messages from the client.
 */
export const baseMessageSchema = z.object({
    /**
     * Unique subscription ID generated and provided by the client.
     * Used to identify the subscription for fetchMore, unsubscribe, or updates.
     */
    id: z.string(),

    /**
     * The logical channel this message relates to.
     * Examples: "backtestsMintResults", "trades".
     */
    channel: z.string(),

    /**
     * Type of action the client wants to perform.
     * Typical values: "subscribe", "unsubscribe", "fetchMore", etc.
     */
    event: inputEventTypeSchema,
});
export type BaseMessage = z.infer<typeof baseMessageSchema>;

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
 * Represents a one-time RPC-style fetch request sent over WebSocket.
 * Unlike a subscription, it does not require prior channel registration.
 *
 * The `id` acts as a request correlation ID (not a subscription ID)
 * and should be echoed back in the corresponding fetch_response message.
 */
export interface FetchRequestMessage extends BaseMessage {
    event: 'fetch';
    /**
     * Request data containing filters and pagination
     */
    data: RequestDataParams;
}

/**
 * Unsubscribe message sent by client
 */
export type UnsubscribeMessage = Omit<BaseMessage, 'id' | 'channel'> & {
    event: 'unsubscribe';
    id?: string;
    channel?: string;
};

/**
 * Server response event types
 */
export type ResponseEventType = 'snapshot' | 'fetchMore' | 'fetch_response' | 'update';

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

export type SnapshotPayload<T> = {
    /**
     * Initial batch of data
     */
    data: T;
    /**
     * Filters applied for this subscription (optional)
     */
    appliedFilters?: PlainFilters;
};

/**
 * Response containing initial snapshot of data for a subscription
 */
export interface DataSubscriptionResponse<T> extends BaseResponse {
    event: 'snapshot';
    snapshot: SnapshotPayload<T>;
}

export type FetchMorePayload<T> = {
    /**
     * Items returned
     */
    paginatedData: CursorPaginatedResponse<T>;

    /**
     * Filters applied for this subscription (optional)
     */
    appliedFilters?: PlainFilters;
};

/**
 * Response containing additional paginated data for a subscription.
 */
export interface DataFetchMoreResponse<T> extends BaseResponse {
    /**
     * Event type is "fetchMore" to distinguish from snapshot and update
     */
    event: 'fetchMore';
    payload: FetchMorePayload<T>;
}

export type FetchResponsePayload<T> = {
    requestId: string;
    status: ProtoFetchStatus;
    data: T | null;
};

export interface FetchResponse<T> extends Omit<BaseResponse, 'id'> {
    event: 'fetch_response';
    payload: FetchResponsePayload<T>;
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

/**
 * Zod schema factory for an RPC message.
 * @param dataSchema Zod schema describing the type of the `data` field.
 *
 * Represents a one-shot Remote Procedure Call (RPC) request sent from the client
 * to the server over WebSocket.
 *
 * RPC messages do NOT use channels and are not tied to subscriptions.
 * Each RPC call:
 * - is initiated by the client
 * - expects exactly one matching "rpc_response" from the server
 * - is correlated using the `id` field
 *
 * @template T The shape of the request payload being sent.
 */
export const rpcMessageSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z.object({
        /**
         * Unique correlation ID assigned by the client.
         * The server must echo this same ID back in the corresponding rpc_response.
         */
        id: z.string(),

        /**
         * Event type indicating this is an RPC request.
         * Always the literal value "rpc".
         */
        event: z.literal('rpc'),

        /**
         * Logical operation name being requested.
         * Example: "get_strategy_status", "estimate_profit", "cancel_order", etc.
         */
        method: z.string(),

        /**
         * Request payload associated with the RPC method.
         * The server interprets this based on the `method` field.
         */
        data: dataSchema,
    });

export type RpcMessage<TSchema extends z.ZodTypeAny = z.ZodUnknown> = InferRpcMessage<TSchema>;
export type InferRpcMessage<TSchema extends z.ZodTypeAny> = z.infer<ReturnType<typeof rpcMessageSchema<TSchema>>>;

/**
 * Base structure for all RPC responses sent by the server.
 *
 * Unlike channel-based responses, RPC responses:
 * - do NOT include a channel
 * - must echo the original RPC request ID
 * - always use the event type "rpc_response"
 */
export interface BaseRpcResponse {
    /**
     * Correlation ID matching the RPC request's `id`.
     * Used to resolve the correct pending RPC promise on the client.
     */
    id: string;

    /**
     * Literal event type identifying this as an RPC response.
     */
    event: 'rpc_response';
}

export interface RpcSuccessPayload<T> {
    status: 'ok';
    method: string;
    data: T;
}
export interface RpcErrorPayload<TError = unknown> {
    status: 'error';
    method: string;
    errorCode: string;
    errorMessage?: string;
    details?: TError; // optional field
}

export type RpcPayload<T = unknown, TError = unknown> = RpcSuccessPayload<T> | RpcErrorPayload<TError>;

/**
 * Represents a typed RPC response payload sent by the server.
 *
 * @template T The shape of the response data returned by the RPC handler.
 */
export interface RpcResponse<T = unknown> extends BaseRpcResponse {
    payload: RpcPayload<T>;
}

/**
 * Union of all client message types
 */
export type WsMessage = SubscribeMessage | FetchRequestMessage | FetchMoreMessage | UnsubscribeMessage | RpcMessage;

export type WsServerResponse<T> =
    | DataSubscriptionResponse<T>
    | DataUpdateResponse<T>
    | DataFetchMoreResponse<T>
    | RpcResponse<T>;

/**
 * Context available to all RPC handlers.
 */
export interface RpcContext {
    ws: WsConnection;
    logger: Logger;
    services?: unknown;
    pubsub: PubSub;
    /**
     * Map of correlationId → resolver for distributed RPC results
     */
    pendingDistributedRpc: Record<string, (data: unknown) => void>;
}

/**
 * Generic RPC handler definition.
 */
export interface RpcHandler<TInput, TOutput> {
    /**
     * Zod schema describing and validating the expected request input.
     *
     * - The router runs `schema.parse()` before calling `run()`.
     * - If parsing fails, the router automatically returns a typed RPC error.
     * - The parsed result is passed as the `data` argument to `run()`.
     */
    schema: z.ZodType<TInput>;

    /**
     * The protobuf message class used to encode the *successful* RPC result (`TOutput`)
     * into its binary representation.
     *
     * This class is expected to be the generated protobufjs static module corresponding
     * to the "data" portion of the RPC response. For example:
     *
     *   GetBacktestResultStatusResponse.encode(result).finish()
     *
     */
    successDataProtoClass: MessageFns<Omit<TOutput, 'correlationId'>>;

    /**
     * The RPC method implementation.
     *
     * Called only after `schema` has validated the input.
     *
     * Must return a plain JSON object whose shape matches `TOutput`.
     * The returned object will be:
     *   - encoded using `successDataProtoClass`
     *   - wrapped in a standard RpcSuccessPayload
     *
     * Any thrown error (sync or async) is caught by the router and transformed
     * into a structured RpcErrorPayload, including optional `details`.
     *
     * @param data - The validated and parsed input, guaranteed to match TInput.
     * @param ctx  - Contextual information injected per request (auth, db, services, etc.).
     */
    run(data: TInput, ctx: RpcContext): Promise<TOutput> | TOutput;
}
