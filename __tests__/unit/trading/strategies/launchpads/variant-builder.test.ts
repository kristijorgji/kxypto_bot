import {
    variantFromBuyContext,
    variantFromSellConfig,
} from '../../../../../src/trading/strategies/launchpads/variant-builder';

describe('variantConfigFromContext', () => {
    it('returns empty string for empty context', () => {
        expect(variantFromBuyContext({})).toBe('');
    });

    it('formats single context with min and max', () => {
        expect(
            variantFromBuyContext({
                price: { min: 1, max: 10 },
            }),
        ).toBe('p:l1-h10');
    });

    it('formats single context with only min', () => {
        expect(
            variantFromBuyContext({
                price: { min: 2 },
            }),
        ).toBe('p:l2');
    });

    it('formats single context with only max', () => {
        expect(
            variantFromBuyContext({
                price: { max: 5 },
            }),
        ).toBe('p:h5');
    });

    it('formats multiple contexts correctly', () => {
        expect(
            variantFromBuyContext({
                price: { min: 1, max: 5 },
                marketCap: { min: 100 },
                devHoldingPercentage: { max: 20 },
            }),
        ).toBe('p:l1-h5_mc:l100_dvp:h20');
    });

    it('skips keys with undefined or empty min/max', () => {
        expect(
            variantFromBuyContext({
                price: {},
                marketCap: { min: 50 },
            }),
        ).toBe('mc:l50');
    });

    it('handles all supported context keys', () => {
        const result = variantFromBuyContext({
            price: { min: 1, max: 2 },
            marketCap: { min: 3, max: 4 },
            bondingCurveProgress: { min: 5, max: 6 },
            holdersCount: { min: 7, max: 8 },
            devHoldingPercentage: { min: 9, max: 10 },
            topTenHoldingPercentage: { min: 11, max: 12 },
        });

        expect(result).toBe('p:l1-h2_mc:l3-h4_bcp:l5-h6_hc:l7-h8_dvp:l9-h10_tthp:l11-h12');
    });
});

describe('variantFromSellContext', () => {
    it('returns empty string when all values are undefined', () => {
        const result = variantFromSellConfig({
            trailingStopLossPercentage: undefined,
            stopLossPercentage: undefined,
            takeProfitPercentage: undefined,
            trailingTakeProfit: undefined,
        });
        expect(result).toBe('');
    });

    it('formats single numeric fields correctly', () => {
        expect(
            variantFromSellConfig({
                trailingStopLossPercentage: 5,
            }),
        ).toBe('tslp:5');

        expect(
            variantFromSellConfig({
                stopLossPercentage: 10,
            }),
        ).toBe('slp:10');

        expect(
            variantFromSellConfig({
                takeProfitPercentage: 15,
            }),
        ).toBe('tpp:15');
    });

    it('formats trailingTakeProfit correctly', () => {
        expect(
            variantFromSellConfig({
                trailingTakeProfit: {
                    profitPercentage: 20,
                    stopPercentage: 5,
                },
            }),
        ).toBe('ttp(pp:20:sp:5)');
    });

    it('formats a combination of values correctly', () => {
        const result = variantFromSellConfig({
            trailingStopLossPercentage: 1,
            takeProfitPercentage: 2,
            trailingTakeProfit: {
                profitPercentage: 3,
                stopPercentage: 4,
            },
        });
        expect(result).toBe('tslp:1_tpp:2_ttp(pp:3:sp:4)');
    });

    it('preserves correct order of fields in output', () => {
        const input = {
            stopLossPercentage: 9,
            trailingStopLossPercentage: 8,
            takeProfitPercentage: 7,
            trailingTakeProfit: {
                profitPercentage: 6,
                stopPercentage: 5,
            },
        };
        const result = variantFromSellConfig(input);
        expect(result).toBe('slp:9_tslp:8_tpp:7_ttp(pp:6:sp:5)');
    });
});
