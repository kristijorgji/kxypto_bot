import { ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

import { readFixture } from '../data';

export function fixtureToParsedTransactionWithMeta(fixturePath: string): ParsedTransactionWithMeta {
    const r = readFixture<ParsedTransactionWithMeta>(fixturePath);

    for (const ac of r.transaction.message.accountKeys) {
        ac.pubkey = new PublicKey(ac.pubkey);
    }

    return r;
}
