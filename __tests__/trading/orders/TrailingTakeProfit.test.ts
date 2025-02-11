import TrailingTakeProfit from '../../../src/trading/orders/TrailingTakeProfit';

describe(TrailingTakeProfit.name, () => {
    let ttp: TrailingTakeProfit;

    beforeEach(() => {
        ttp = new TrailingTakeProfit({
            entryPrice: 100,
            trailingProfitPercentage: 10,
            trailingStopPercentage: 15,
        });
    });

    test('should not trigger sell if not activated, it will not act as a stop loss before reaching activation', () => {
        expect(ttp.updatePrice(14)).toEqual(false);
    });

    test('should initialize with correct take, stop and highest price', () => {
        expect(ttp.getTakeProfitPrice()).toBeCloseTo(110, 8);
        expect(ttp.getStopPrice()).toBeCloseTo(85, 8);
        expect(ttp.getHighestPrice()).toBeCloseTo(100);
    });

    test('should not sell as long as the price keeps increasing above stopPrice', () => {
        for (let i = 86; i <= 230; i++) {
            expect(ttp.updatePrice(i)).toBe(false);
        }

        expect(ttp.getTakeProfitPrice()).toBeCloseTo(253, 8);
        expect(ttp.getStopPrice()).toBeCloseTo(195.5, 8);
    });

    test('should lock-in profit and sell after the price increases then drops down below the stopPrice', () => {
        for (let i = 101; i <= 160; i++) {
            expect(ttp.updatePrice(i)).toBe(false);
        }

        for (let i = 160; i >= 137; i--) {
            expect(ttp.updatePrice(i)).toBe(false);
        }

        expect(ttp.updatePrice(136)).toBe(true);
    });

    test('should not update takeProfit when price goes down', () => {
        for (let i = 99; i >= 50; i--) {
            ttp.updatePrice(i);
        }

        expect(ttp.getTakeProfitPrice()).toBeCloseTo(110, 8);
    });

    const updateTakeProfitCases: [string, number, number][] = [
        ['does not updates take profit price when new high is 105 as it is below initial take profit level', 105, 110],
        ['updates take profit price when new high is 111', 111, 122.1],
        ['does not update take profit when price stays the same or decreases', 100, 110],
        ['does not update take profit when price stays the same or decreases', 99, 110],
    ];
    test.each(updateTakeProfitCases)('%s', (_, newHigh, expectedTakeProfitPrice) => {
        ttp.updatePrice(newHigh);
        expect(ttp.getTakeProfitPrice()).toBeCloseTo(expectedTakeProfitPrice, 8);
    });

    test('should return the highest price correctly', () => {
        // doesn't update as it is not activated yet, still below takeProfit of 110
        ttp.updatePrice(105);
        expect(ttp.getHighestPrice()).toBe(100);

        // should update now as it is above takeProfit
        ttp.updatePrice(110.01);
        expect(ttp.getHighestPrice()).toBeCloseTo(110.01, 8);
        expect(ttp.getTakeProfitPrice()).toBeCloseTo(121.011, 8);
    });
});
