export default class TakeProfitPercentage {
    private readonly _takeProfitPrice: number;

    constructor(entryPrice: number, profitPercentage: number) {
        if (entryPrice <= 0) {
            throw new Error('Entry price must be a positive value.');
        }
        if (profitPercentage <= 0) {
            throw new Error('Profit percentage must be a positive value.');
        }

        this._takeProfitPrice = entryPrice * (profitPercentage / 100 + 1);
    }

    updatePrice(currentPrice: number): boolean {
        return currentPrice >= this._takeProfitPrice;
    }

    get takeProfitPrice(): number {
        return this._takeProfitPrice;
    }
}
