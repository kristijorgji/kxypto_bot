import crypto from 'crypto';

import { Blockchain } from '../../db/types';

export function generateTradeId(blockchain: Blockchain, assetSymbol: string): string {
    const timestamp = Date.now().toString().slice(0, 12); // Use the first 12 characters of the timestamp
    const blockchainAbbrev = blockchain.slice(0, 6); // Take first 6 characters of the blockchain name
    const randomStr = crypto.randomBytes(5).toString('hex'); // Generate a 10-character random string

    const tradeId = `${blockchainAbbrev}-${assetSymbol}-${timestamp}-${randomStr}`;

    // Make sure tradeId doesn't exceed 50 characters
    if (tradeId.length > 50) {
        // Trim or truncate as needed
        return tradeId.slice(0, 50);
    }

    return tradeId;
}
