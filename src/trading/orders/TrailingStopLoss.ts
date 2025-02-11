export default class TrailingStopLoss {
    private highestPrice: number;
    private readonly trailingDecimal: number;
    private stopPrice: number;

    constructor(entryPrice: number, trailingPercentage: number) {
        this.highestPrice = entryPrice;
        this.trailingDecimal = trailingPercentage / 100;
        this.stopPrice = entryPrice * (1 - this.trailingDecimal);
    }

    updatePrice(currentPrice: number): boolean {
        if (currentPrice > this.highestPrice) {
            this.highestPrice = currentPrice;
            this.stopPrice = this.highestPrice * (1 - this.trailingDecimal);
        }

        return currentPrice <= this.stopPrice;
    }

    getStopPrice(): number {
        return this.stopPrice;
    }

    getTrailingPercentage(): number {
        return this.trailingDecimal * 100;
    }
}
