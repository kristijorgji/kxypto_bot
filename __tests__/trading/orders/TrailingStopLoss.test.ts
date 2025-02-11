import TrailingStopLoss from '../../../src/trading/orders/TrailingStopLoss';

describe(TrailingStopLoss.name, () => {
    let tsl: TrailingStopLoss;
    const trailingPercentage = 10;

    beforeEach(() => {
        tsl = new TrailingStopLoss(4, trailingPercentage);
    });

    test('initial stop price should be set correctly', () => {
        expect(tsl.getStopPrice()).toBe(3.6);
    });

    test('does not trigger and updates stop loss when price moves higher', () => {
        for (let i = 4; i <= 20; i++) {
            expect(tsl.updatePrice(i)).toBe(false);
            expect(tsl.getStopPrice()).toBeCloseTo(i - (trailingPercentage / 100) * i, 8);
        }
    });

    test('does not update stop loss when price goes lower but stays above stop price. Triggers when stop loss reached', () => {
        for (let i = 4; i >= 3.62; i -= 0.2) {
            expect(tsl.updatePrice(i)).toBe(false);
            expect(tsl.getStopPrice()).toBeCloseTo(3.6);
        }

        expect(tsl.updatePrice(3.6)).toBe(true);
    });

    test('triggers stop loss when price falls below stop price', () => {
        tsl.updatePrice(10);
        expect(tsl.updatePrice(8.9)).toBe(true);
    });
});
