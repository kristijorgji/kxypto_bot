import TakeProfitPercentage from '../../../../src/trading/orders/TakeProfitPercentage';

describe(TakeProfitPercentage.name, () => {
    test('should throw an error if entry price is less than or equal to zero', () => {
        expect(() => new TakeProfitPercentage(0, 10)).toThrow('Entry price must be a positive value.');
        expect(() => new TakeProfitPercentage(-1, 10)).toThrow('Entry price must be a positive value.');
    });

    test('should throw an error if profit percentage is less than or equal to zero', () => {
        expect(() => new TakeProfitPercentage(100, 0)).toThrow('Profit percentage must be a positive value.');
        expect(() => new TakeProfitPercentage(100, -5)).toThrow('Profit percentage must be a positive value.');
    });

    test('should correctly calculate the take-profit price based on entry price and profit percentage', () => {
        const takeProfit = new TakeProfitPercentage(100, 10);
        expect(takeProfit.takeProfitPrice).toBeCloseTo(110, 8);

        const takeProfit2 = new TakeProfitPercentage(200, 20);
        expect(takeProfit2.takeProfitPrice).toBeCloseTo(240, 8);
    });

    test('should return true when current price is greater than or equal to take-profit price', () => {
        const takeProfit = new TakeProfitPercentage(100, 10);

        expect(takeProfit.updatePrice(110.0000000001)).toBe(true);
        expect(takeProfit.updatePrice(120)).toBe(true);
    });

    test('should return false when current price is less than take-profit price', () => {
        const takeProfit = new TakeProfitPercentage(100, 10);

        expect(takeProfit.updatePrice(109.99)).toBe(false);
        expect(takeProfit.updatePrice(109)).toBe(false);
        expect(takeProfit.updatePrice(100)).toBe(false);
    });
});
