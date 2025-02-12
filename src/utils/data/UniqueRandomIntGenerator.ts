export default class UniqueRandomIntGenerator {
    private readonly availableNumbers: Set<number> | null;
    private usedNumbers: Set<number>;
    private readonly min: number | null;
    private readonly max: number | null;
    private current: number;

    constructor(min?: number, max?: number) {
        this.min = min ?? null;
        this.max = max ?? null;
        this.usedNumbers = new Set();
        this.current = min ?? 0; // Start from min if provided, otherwise from 0

        if (min !== undefined && max !== undefined) {
            if (min > max) throw new Error('min must be less than or equal to max');

            this.availableNumbers = new Set();
            for (let i = min; i <= max; i++) {
                this.availableNumbers.add(i);
            }
        } else {
            this.availableNumbers = null; // Infinite mode
        }
    }

    next(): number {
        if (this.availableNumbers) {
            // **Finite Mode:** Pick a unique number within the range
            if (this.availableNumbers.size === 0) {
                throw new Error('No more unique numbers available');
            }

            const numbersArray = Array.from(this.availableNumbers);
            const randomIndex = Math.floor(Math.random() * numbersArray.length);
            const selectedNumber = numbersArray[randomIndex];

            this.availableNumbers.delete(selectedNumber);
            this.usedNumbers.add(selectedNumber);
            return selectedNumber;
        }

        // **Infinite Mode:** Generate a number that has never been used before
        while (this.usedNumbers.has(this.current)) {
            this.current++;
        }

        this.usedNumbers.add(this.current);
        return this.current++;
    }

    reset() {
        this.usedNumbers.clear();
        this.current = this.min ?? 0;

        if (this.availableNumbers) {
            // Reset finite mode
            this.availableNumbers.clear();
            for (let i = this.min!; i <= this.max!; i++) {
                this.availableNumbers.add(i);
            }
        }
    }
}
