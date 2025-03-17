import { GetTokenCreatorStatsResult } from '../../../../../../src/db/repositories/tokenAnalytics';
import * as tokenAnalytics from '../../../../../../src/db/repositories/tokenAnalytics';
import isTokenCreatorSafe, {
    IsCreatorSafeReason,
} from '../../../../../../src/trading/bots/blockchains/solana/isTokenCreatorSafe';

jest.mock('../../../../../../src/db/repositories/tokenAnalytics', () => ({
    getTokenCreatorStats: jest.fn(),
}));

describe(isTokenCreatorSafe.name, () => {
    const creator = 'FtZEUhBnb9zsNhNkTv2GPekLBVKhzCVeLyZH6ZHfaE4n';

    const cases: [string, GetTokenCreatorStatsResult, boolean, IsCreatorSafeReason][] = [
        [
            'should reject if more than half of their tokens were dumped and had at least 12 results',
            {
                createdCount: 12,
                results: [
                    {
                        exit_code: 'DUMPED',
                        count: 6,
                    },
                    {
                        exit_code: 'NO_PUMP',
                        count: 6,
                    },
                ],
            },
            false,
            'low_success_rate',
        ],
        [
            'should not reject if has more than half dumped and less than 12 results',
            {
                createdCount: 11,
                results: [
                    {
                        exit_code: 'DUMPED',
                        count: 7,
                    },
                    {
                        exit_code: 'NO_PUMP',
                        count: 4,
                    },
                ],
            },
            true,
            'default',
        ],
        [
            'should reject if it is already flagged',
            {
                createdCount: 12,
                results: [
                    {
                        exit_code: 'BAD_CREATOR',
                        count: 1,
                    },
                    {
                        exit_code: 'NO_PUMP',
                        count: 11,
                    },
                ],
            },
            false,
            'already_flagged',
        ],
        [
            'should allow if less than half were dumped',
            {
                createdCount: 21,
                results: [
                    {
                        exit_code: 'DUMPED',
                        count: 10,
                    },
                    {
                        exit_code: 'NO_PUMP',
                        count: 11,
                    },
                ],
            },
            true,
            'default',
        ],
        [
            'should allow if it is a new creator without a previous history',
            {
                createdCount: 0,
                results: [],
            },
            true,
            'no_previous_history',
        ],
    ];

    test.each(cases)('%s', async (_, getTokenCreatorStatsResult, isSafe, reason) => {
        (tokenAnalytics.getTokenCreatorStats as jest.Mock).mockResolvedValue(getTokenCreatorStatsResult);

        expect(await isTokenCreatorSafe(creator)).toEqual({
            safe: isSafe,
            reason: reason,
            data: getTokenCreatorStatsResult,
        });

        expect(tokenAnalytics.getTokenCreatorStats as jest.Mock).toHaveBeenCalledWith('solana', 'pumpfun', creator);
    });
});
