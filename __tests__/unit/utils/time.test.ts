import { getDateSecondsAgo, getSecondsDifference } from '../../../src/utils/time';

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

describe('getSecondsDifference', () => {
    test('should return the correct difference in seconds when dates are the same', () => {
        const date1 = new Date('2024-03-06T12:00:00');
        const date2 = new Date('2024-03-06T12:00:00');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(0); // No difference, should return 0
    });

    test('should return the correct difference in seconds for dates 1 minute apart', () => {
        const date1 = new Date('2024-03-06T12:00:00');
        const date2 = new Date('2024-03-06T12:01:00');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(60); // 1 minute = 60 seconds
    });

    test('should return the correct difference in seconds for dates with different times', () => {
        const date1 = new Date('2024-03-06T12:00:00');
        const date2 = new Date('2024-03-06T12:02:30');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(150); // 2 minutes and 30 seconds = 150 seconds
    });

    test('should return the absolute difference in seconds when end date is earlier', () => {
        const date1 = new Date('2024-03-06T12:05:00');
        const date2 = new Date('2024-03-06T12:00:00');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(300); // 5 minutes = 300 seconds (absolute difference)
    });

    test('should work with dates in the past and future', () => {
        const date1 = new Date('2020-03-06T12:00:00');
        const date2 = new Date('2025-03-06T12:00:00');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBeGreaterThan(0); // Should be a positive value (difference in seconds)
    });

    test('should handle edge case with different years', () => {
        const date1 = new Date('2020-12-31T23:59:59');
        const date2 = new Date('2021-01-01T00:00:00');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(1); // Difference is 1 second
    });

    test('should handle edge case with different months', () => {
        const date1 = new Date('2024-02-29T23:59:59'); // Leap year
        const date2 = new Date('2024-03-01T00:00:01');

        const result = getSecondsDifference(date1, date2);
        expect(result).toBe(2); // Difference is 2 seconds
    });
});
