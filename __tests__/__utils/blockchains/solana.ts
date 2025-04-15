import { ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

import { HistoryEntry } from '../../../src/trading/bots/launchpads/types';
import { readFixture } from '../data';

export function fixtureToParsedTransactionWithMeta(fixturePath: string): ParsedTransactionWithMeta {
    const r = readFixture<ParsedTransactionWithMeta>(fixturePath);

    for (const ac of r.transaction.message.accountKeys) {
        ac.pubkey = new PublicKey(ac.pubkey);
    }

    return r;
}

export function formHistoryEntry(data: Partial<HistoryEntry>): HistoryEntry {
    return {
        timestamp: data.timestamp ?? 1,
        // eslint-disable-next-line no-loss-of-precision
        price: data.price ?? 3.0355480118319034e-8,
        marketCap: data.marketCap ?? 31.770000079,
        bondingCurveProgress: data.bondingCurveProgress ?? 25,
        holdersCount: data.holdersCount ?? 15,
        devHoldingPercentage: data.devHoldingPercentage ?? 10,
        topTenHoldingPercentage: data.topTenHoldingPercentage ?? 35,
    };
}
