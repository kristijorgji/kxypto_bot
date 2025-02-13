export default class TakeProfitPercentage {
    private readonly _takeProfitPrice: number;

    constructor(entryPrice: number, trailingProfitPercentage: number) {
        if (entryPrice <= 0) {
            throw new Error('Entry price must be a positive value.');
        }
        if (trailingProfitPercentage <= 0) {
            throw new Error('Profit percentage must be a positive value.');
        }

        this._takeProfitPrice = entryPrice * (trailingProfitPercentage / 100 + 1);
    }

    updatePrice(currentPrice: number): boolean {
        return currentPrice >= this._takeProfitPrice;
    }

    get takeProfitPrice(): number {
        return this._takeProfitPrice;
    }
}
