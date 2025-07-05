import seedrandom from 'seedrandom';

export function bufferFromUInt64(value: number | string) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));

    return buffer;
}

export function randomDecimal(min: number, max: number, decimals: number): number {
    const factor = Math.pow(10, decimals);

    return Math.round((Math.random() * (max - min) + min) * factor) / factor;
}

export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function deepClone<T>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
}

export function shuffle<T>(array: T[], seed?: string): T[] {
    const rng = seed ? seedrandom(seed) : Math.random;

    return array
        .map(value => [typeof rng === 'function' ? rng() : rng, value] as [number, T])
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value);
}
