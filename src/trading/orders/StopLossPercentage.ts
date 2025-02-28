export default class StopLossPercentage {
    private readonly _stopPrice: number;

    constructor(entryPrice: number, public readonly stopPercentage: number) {
        if (entryPrice <= 0) {
            throw new Error('Entry price must be a positive value.');
        }
        if (stopPercentage <= 0) {
            throw new Error('Stop percentage must be a positive value.');
        }

        this._stopPrice = entryPrice * (1 - stopPercentage / 100);
    }

    updatePrice(currentPrice: number): boolean {
        if (currentPrice <= 0) {
            throw new Error('Current price must be a positive value.');
        }

        return currentPrice <= this._stopPrice;
    }

    get stopPrice(): number {
        return this._stopPrice;
    }
}
