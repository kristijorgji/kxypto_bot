import { Connection } from '@solana/web3.js';

/**
 * Singleton instance of the Solana Connection.
 *
 * Reuse this connection throughout your application to:
 * - Centralize all RPC requests through one client, which helps prevent unintentional duplicate requests.
 * - Avoid creating multiple WebSocket subscriptions (e.g., for account or slot changes) that can occur with multiple instances.
 * - Ensure consistent configuration and resource sharing, which is important for managing rate limits imposed by the RPC provider.
 *
 * Note: Using a singleton doesn't inherently reduce the number of HTTP requests if your application logic issues them;
 * it simply avoids the redundant or duplicate requests that can occur when multiple independent connections are created.
 *
 * Make sure the environment variables `SOLANA_RPC_ENDPOINT` and `SOLANA_WSS_ENDPOINT` are set to the appropriate endpoints.
 */
export const solanaConnection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string, {
    wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
});
