export function getRandomDecimal(min: number, max: number, decimals: number): number {
    const factor = Math.pow(10, decimals);

    return Math.round((Math.random() * (max - min) + min) * factor) / factor;
}
