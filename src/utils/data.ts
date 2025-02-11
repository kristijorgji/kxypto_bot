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
