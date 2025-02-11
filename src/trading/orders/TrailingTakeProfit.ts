/**
 * A Trailing Take Profit order that activates only after the price moves favorably.
 *
 * This order stays inactive until the price first reaches a predefined take-profit level.
 * Once activated, it continuously adjusts the take-profit and stop-loss prices as the price moves higher,
 * ensuring profits are locked in while allowing further gains.
 *
 * ## How It Works:
 * - **Initial State:** The order is inactive, with no trailing stop-loss.
 * - **Activation:** When the price first surpasses the take-profit threshold, the trailing mechanism begins.
 * - **Trailing Mechanism:** If the price rises further, both the take-profit and stop-loss levels adjust upwards.
 * - **Exit Condition:** The order is triggered **only when the price drops to the trailing stop-loss level**.
 *
 * This prevents premature exits while securing profits in an uptrend. The take-profit level continues moving up,
 * but **the sell occurs only if the price falls back to the adjusted stop-loss level**.
 */
export default class TrailingTakeProfit {
    private highestPrice: number;
    private readonly trailingProfitDecimal: number;
    private readonly trailingStopDecimal: number;
    private takeProfitPrice: number;
    private stopPrice: number;
    private isActive: boolean = false;

    constructor({
        entryPrice,
        trailingProfitPercentage,
        trailingStopPercentage,
    }: {
        entryPrice: number;
        trailingProfitPercentage: number;
        trailingStopPercentage: number;
    }) {
        this.highestPrice = entryPrice;
        this.trailingProfitDecimal = trailingProfitPercentage / 100;
        this.trailingStopDecimal = trailingStopPercentage / 100;
        this.takeProfitPrice = entryPrice * (1 + this.trailingProfitDecimal);
        this.stopPrice = entryPrice * (1 - this.trailingStopDecimal);
    }

    updatePrice(currentPrice: number): boolean {
        // Step 1: Activate trailing once price exceeds initial take profit level
        if (!this.isActive && currentPrice >= this.takeProfitPrice) {
            this.isActive = true;
        }

        // Step 2: If already active, adjust trailing levels
        if (this.isActive && currentPrice > this.highestPrice) {
            this.highestPrice = currentPrice;
            this.takeProfitPrice = this.highestPrice * (1 + this.trailingProfitDecimal);
            this.stopPrice = this.highestPrice * (1 - this.trailingStopDecimal);
        }

        // Step 3: Only check stop/loss triggers if trailing is active
        if (this.isActive) {
            return currentPrice <= this.stopPrice || currentPrice >= this.takeProfitPrice;
        }

        return false;
    }

    getTrailingProfitPercentage(): number {
        return this.trailingProfitDecimal * 100;
    }

    getTrailingStopPercentage(): number {
        return this.trailingStopDecimal * 100;
    }

    getTakeProfitPrice(): number {
        return this.takeProfitPrice;
    }

    getStopPrice(): number {
        return this.stopPrice;
    }

    getHighestPrice(): number {
        return this.highestPrice;
    }

    toJSON() {
        return {
            highestPrice: this.highestPrice,
            trailingProfitPercentage: this.getTrailingProfitPercentage(),
            trailingStopPercentage: this.getTrailingStopPercentage(),
            takeProfitPrice: this.takeProfitPrice,
            stopPrice: this.stopPrice,
        };
    }
}
