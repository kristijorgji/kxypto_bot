import { Buffer } from 'buffer';

/**
 * Forms a hybrid message consisting of:
 * [4-byte JSON header length][JSON header][binary payload]
 *
 * @param header - The JSON-serializable header (metadata)
 * @param payload - The binary payload (usually protobuf-encoded)
 * @returns Combined message as a Uint8Array ready to send
 */
export function formHybridMessage(header: object, payload: Uint8Array): Uint8Array {
    // Encode header as UTF-8 JSON
    const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8');

    // 4-byte prefix for header length
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(headerBuffer.length, 0);

    // Use zero-copy for payload if already a Buffer
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

    return Buffer.concat([lengthBuffer, headerBuffer, payloadBuffer]);
}

/**
 * Parses a hybrid WebSocket message of the format:
 * [4-byte header length][JSON header][protobuf payload]
 */
export function parseHybridMessage<H = unknown>(
    raw: Buffer,
): {
    header: H;
    payloadBuffer: Buffer | null;
} {
    if (raw.length < 4) {
        throw new Error('Invalid message: missing header length prefix');
    }

    // 1️⃣ Read header length (first 4 bytes)
    const headerLength = raw.readUInt32BE(0);

    if (headerLength <= 0 || raw.length < 4 + headerLength) {
        throw new Error('Invalid message: incomplete or corrupted header');
    }

    // 2️⃣ Extract and parse JSON header
    const headerStart = 4;
    const headerEnd = headerStart + headerLength;
    const headerJson = raw.subarray(headerStart, headerEnd).toString('utf8');

    let header: H;
    try {
        header = JSON.parse(headerJson);
    } catch (err) {
        throw new Error('Invalid JSON header: ' + (err as Error).message);
    }

    // 3️⃣ Extract binary protobuf payload
    const payloadBuffer = raw.length > headerEnd ? raw.subarray(headerEnd) : null;

    return { header, payloadBuffer };
}
