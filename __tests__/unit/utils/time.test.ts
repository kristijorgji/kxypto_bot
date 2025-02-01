import { getDateSecondsAgo } from '../../../src/utils/time';

describe('getDateSecondsAgo', () => {
    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-02-01T16:04:00.000Z'));
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    type TcParams = [string, number, string];
    const cases: TcParams[] = [
        ['0 seconds ago → today date', 0, '2025-02-01'],
        ['10 seconds ago', 10, '2025-02-01'],
        ['1 day ago', 86400, '2025-01-31'],
        ['2 days ago', 172800, '2025-01-30'],
        ['1 week ago', 604800, '2025-01-25'],
    ];

    test.each(cases)('%s', (_, secondsAgo, expectedDateString) => {
        expect(getDateSecondsAgo(secondsAgo)).toBe(expectedDateString);
    });

    test('returns date in YYYY-MM-DD format', () => {
        expect(getDateSecondsAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
