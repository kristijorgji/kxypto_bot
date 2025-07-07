import { MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import { checkInterval, shouldBuyStateless } from '../../../../../src/trading/strategies/launchpads/common';
import { IntervalConfig, LaunchpadStrategyBuyConfig } from '../../../../../src/trading/strategies/types';
import { formMarketContext } from '../../../../__utils/blockchains/solana';

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
            devHoldingPercentageCirculating: { min: 5, max: 20 },
            topTenHoldingPercentageCirculating: { min: 5, max: 70 },
            topHolderCirculatingPercentage: { min: 10, max: 12 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
            devHoldingPercentageCirculating: 20,
            topTenHoldingPercentageCirculating: 70,
            topHolderCirculatingPercentage: 12,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(true);
    });

    test('should return false when holdersCount is below the min range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    holdersCount: 50, // Below min
                }),
            ),
        ).toBe(false);
    });

    test('should return false when bondingCurveProgress is above the max range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            bondingCurveProgress: { min: 10, max: 90 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    bondingCurveProgress: 95, // Above max
                }),
            ),
        ).toBe(false);
    });

    test('should return false when devHoldingPercentage is below min', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            devHoldingPercentage: { min: 5, max: 15 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    devHoldingPercentage: 3, // Below min
                }),
            ),
        ).toBe(false);
    });

    test('should return true if config is empty (no constraints)', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {}; // No constraints

        expect(shouldBuyStateless(buyConfig, formMarketContext({}))).toBe(true);
    });

    test('should return false if any value is out of range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
            bondingCurveProgress: { min: 10, max: 90 },
            devHoldingPercentage: { min: 2, max: 10 },
            topTenHoldingPercentage: { min: 5, max: 50 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    holdersCount: 600, // Exceeds max
                }),
            ),
        ).toBe(false);
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

    test('should return true when the value is null and config is empty or undefined (no constraints)', () => {
        expect(checkInterval({}, null)).toBe(true);
        expect(checkInterval(undefined, null)).toBe(true);
    });

    test('should return false when the value is null and we have constrains', () => {
        const config: IntervalConfig = {
            min: 1,
        };
        expect(checkInterval(config, null)).toBe(false);
    });
});
