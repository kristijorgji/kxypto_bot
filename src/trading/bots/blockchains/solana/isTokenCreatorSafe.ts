import { GetTokenCreatorStatsResult, getTokenCreatorStats } from '../../../../db/repositories/tokenAnalytics';

export type IsCreatorSafeReason = 'default' | 'already_flagged' | 'no_previous_history' | 'low_success_rate';

type IsTokenCreatorSafeResponse = {
    safe: boolean;
    reason: IsCreatorSafeReason;
    data: GetTokenCreatorStatsResult;
};

export default async function isTokenCreatorSafe(creator: string): Promise<IsTokenCreatorSafeResponse> {
    const creatorStats = await getTokenCreatorStats('solana', 'pumpfun', creator);

    let totalResultsCount = 0;
    let badResultsCount = 0;
    let isAlreadyFlagged = false;
    for (const result of creatorStats.results) {
        if (result.exit_code === 'DUMPED') {
            badResultsCount += result.count;
        } else if (result.exit_code === 'BAD_CREATOR') {
            isAlreadyFlagged = true;
            break;
        }

        totalResultsCount += result.count;
    }

    let safe = true;
    let reason: IsCreatorSafeReason = 'default';

    if (isAlreadyFlagged) {
        safe = false;
        reason = 'already_flagged';
    } else if (totalResultsCount === 0) {
        safe = true;
        reason = 'no_previous_history';
    } else if (totalResultsCount >= 12 && badResultsCount / totalResultsCount >= 0.5) {
        safe = false;
        reason = 'low_success_rate';
    }

    return {
        safe: safe,
        reason: reason,
        data: creatorStats,
    };
}
