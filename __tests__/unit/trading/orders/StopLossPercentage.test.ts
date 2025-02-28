import StopLossPercentage from '../../../../src/trading/orders/StopLossPercentage';

describe(StopLossPercentage.name, () => {
    describe('Constructor', () => {
        test('should correctly calculate stop price', () => {
            const stopLoss = new StopLossPercentage(100, 10); // 10% stop loss
            expect(stopLoss.stopPrice).toBe(90); // 100 - (10% of 100)
        });

        test('should throw an error if entryPrice is 0', () => {
            expect(() => new StopLossPercentage(0, 10)).toThrow('Entry price must be a positive value.');
        });

        test('should throw an error if entryPrice is negative', () => {
            expect(() => new StopLossPercentage(-100, 10)).toThrow('Entry price must be a positive value.');
        });

        test('should throw an error if stopPercentage is 0', () => {
            expect(() => new StopLossPercentage(100, 0)).toThrow('Stop percentage must be a positive value.');
        });

        test('should throw an error if stopPercentage is negative', () => {
            expect(() => new StopLossPercentage(100, -10)).toThrow('Stop percentage must be a positive value.');
        });
    });

    describe('updatePrice', () => {
        test('should return false if current price is above stop price', () => {
            const stopLoss = new StopLossPercentage(100, 10);
            expect(stopLoss.updatePrice(95)).toBe(false); // 95 > 90
        });

        test('should return true if current price is equal to stop price', () => {
            const stopLoss = new StopLossPercentage(100, 10);
            expect(stopLoss.updatePrice(90)).toBe(true); // 90 == 90
        });

        test('should return true if current price is below stop price', () => {
            const stopLoss = new StopLossPercentage(100, 10);
            expect(stopLoss.updatePrice(85)).toBe(true); // 85 < 90
        });

        test('should throw an error if current price is 0', () => {
            const stopLoss = new StopLossPercentage(100, 10);
            expect(() => stopLoss.updatePrice(0)).toThrow('Current price must be a positive value.');
        });

        test('should throw an error if current price is negative', () => {
            const stopLoss = new StopLossPercentage(100, 10);
            expect(() => stopLoss.updatePrice(-50)).toThrow('Current price must be a positive value.');
        });
    });
});
