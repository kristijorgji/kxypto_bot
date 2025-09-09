import { ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';

import { HistoryEntry, MarketContext } from '../../../src/trading/bots/launchpads/types';
import { readFixture } from '../data';

export function fixtureToParsedTransactionWithMeta(fixturePath: string): ParsedTransactionWithMeta {
    return objToParsedTransactionWithMeta(readFixture<ParsedTransactionWithMeta>(fixturePath));
}

export function objToParsedTransactionWithMeta(r: ParsedTransactionWithMeta): ParsedTransactionWithMeta {
    for (const ac of r.transaction.message.accountKeys) {
        ac.pubkey = new PublicKey(ac.pubkey);
    }

    return r;
}

export function formMarketContext(data: Partial<MarketContext>, copy?: MarketContext): MarketContext {
    return {
        price: data.price ?? copy?.price ?? 4.2e-7,
        marketCap: data.marketCap ?? copy?.marketCap ?? 60,
        holdersCount: data.holdersCount ?? copy?.holdersCount ?? 70,
        bondingCurveProgress: data.bondingCurveProgress ?? copy?.bondingCurveProgress ?? 50,
        devHoldingPercentage: data.devHoldingPercentage ?? copy?.devHoldingPercentage ?? 5,
        topTenHoldingPercentage: data.topTenHoldingPercentage ?? copy?.topTenHoldingPercentage ?? 10,
        devHoldingPercentageCirculating:
            data.devHoldingPercentageCirculating ?? copy?.devHoldingPercentageCirculating ?? 20,
        topTenHoldingPercentageCirculating:
            data.topTenHoldingPercentageCirculating ?? copy?.topTenHoldingPercentageCirculating ?? 70,
        topHolderCirculatingPercentage:
            data.topHolderCirculatingPercentage ?? copy?.topHolderCirculatingPercentage ?? 12,
    };
}

export function formHistoryEntry(data?: Partial<HistoryEntry>, copy?: HistoryEntry): HistoryEntry {
    return {
        timestamp: data?.timestamp ?? copy?.timestamp ?? 1,
        // eslint-disable-next-line no-loss-of-precision
        price: data?.price ?? copy?.price ?? 3.0355480118319034e-8,
        marketCap: data?.marketCap ?? copy?.marketCap ?? 31.770000079,
        bondingCurveProgress: data?.bondingCurveProgress ?? copy?.bondingCurveProgress ?? 25,
        holdersCount: data?.holdersCount ?? copy?.holdersCount ?? 15,
        devHoldingPercentage: data?.devHoldingPercentage ?? copy?.devHoldingPercentage ?? 10,
        topTenHoldingPercentage: data?.topTenHoldingPercentage ?? copy?.topTenHoldingPercentage ?? 35,
        devHoldingPercentageCirculating:
            data?.devHoldingPercentageCirculating ?? copy?.devHoldingPercentageCirculating ?? 20,
        topTenHoldingPercentageCirculating:
            data?.topTenHoldingPercentageCirculating ?? copy?.topTenHoldingPercentageCirculating ?? 70,
        topHolderCirculatingPercentage:
            data?.topHolderCirculatingPercentage ?? copy?.topHolderCirculatingPercentage ?? 12,
        _metadata: data?._metadata ?? copy?._metadata ?? undefined,
    };
}
