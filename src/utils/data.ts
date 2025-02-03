export function bufferFromUInt64(value: number | string) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));

    return buffer;
}
