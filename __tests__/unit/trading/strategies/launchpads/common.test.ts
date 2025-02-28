import { MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import { checkInterval, shouldBuyStateless } from '../../../../../src/trading/strategies/launchpads/common';
import { IntervalConfig, LaunchpadStrategyBuyConfig } from '../../../../../src/trading/strategies/types';

describe(shouldBuyStateless.name, () => {
    test('should return true when all values are within range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            price: {
                min: 100,
                max: 101,
            },
            marketCap: {
                min: 100,
                max: 101,
            },
            holdersCount: { min: 100, max: 500 },
            bondingCurveProgress: { min: 10, max: 90 },
            devHoldingPercentage: { min: 2, max: 10 },
            topTenHoldingPercentage: { min: 5, max: 50 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(true);
    });

    test('should return false when holdersCount is below the min range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 50, // Below min
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(false);
    });

    test('should return false when bondingCurveProgress is above the max range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            bondingCurveProgress: { min: 10, max: 90 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 95, // Above max
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(false);
    });

    test('should return false when devHoldingPercentage is below min', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            devHoldingPercentage: { min: 5, max: 15 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 50,
            devHoldingPercentage: 3, // Below min
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(false);
    });

    test('should return true if config is empty (no constraints)', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {}; // No constraints

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 50,
            devHoldingPercentage: 3,
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(true);
    });

    test('should return false if any value is out of range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
            bondingCurveProgress: { min: 10, max: 90 },
            devHoldingPercentage: { min: 2, max: 10 },
            topTenHoldingPercentage: { min: 5, max: 50 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 600, // Exceeds max
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(false);
    });
});

describe(checkInterval.name, () => {
    test('should return true when value is within range', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 30)).toBe(true); // 30 is within 10-50
    });

    test('should return false when value is below min', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 5)).toBe(false); // 5 is below min (10)
    });

    test('should return false when value is above max', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 55)).toBe(false); // 55 is above max (50)
    });

    test('should return true when value is exactly min', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 10)).toBe(true); // 10 is exactly min
    });

    test('should return true when value is exactly max', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 50)).toBe(true); // 50 is exactly max
    });

    test('should return true when only min is set and value is above min', () => {
        const config: IntervalConfig = { min: 10 };
        expect(checkInterval(config, 15)).toBe(true); // 15 is above min (10)
    });

    test('should return false when only min is set and value is below min', () => {
        const config: IntervalConfig = { min: 10 };
        expect(checkInterval(config, 5)).toBe(false); // 5 is below min (10)
    });

    test('should return true when only max is set and value is below max', () => {
        const config: IntervalConfig = { max: 50 };
        expect(checkInterval(config, 30)).toBe(true); // 30 is below max (50)
    });

    test('should return false when only max is set and value is above max', () => {
        const config: IntervalConfig = { max: 50 };
        expect(checkInterval(config, 60)).toBe(false); // 60 is above max (50)
    });

    test('should return true when config is undefined (no constraints)', () => {
        expect(checkInterval(undefined, 100)).toBe(true); // No constraints, should always return true
    });

    test('should return true when config is empty (no constraints)', () => {
        const config: IntervalConfig = {};
        expect(checkInterval(config, 100)).toBe(true); // No min or max, should always return true
    });
});
