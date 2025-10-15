import { Buffer } from 'buffer';

import { formHybridMessage, parseHybridMessage } from '../../../../src/protos/utils/hybridMessage';

describe('hybridMessage utils', () => {
    it('should form and parse a message correctly', () => {
        const header = { type: 'test', version: 1 };
        const payload = Buffer.from('hello world');

        const hybrid = formHybridMessage(header, payload);
        const { header: parsedHeader, payloadBuffer } = parseHybridMessage<typeof header>(hybrid as Buffer);

        expect(parsedHeader).toEqual(header);
        expect(payloadBuffer?.toString()).toBe('hello world');
    });

    it('should handle empty payload correctly', () => {
        const header = { event: 'ping' };
        const hybrid = formHybridMessage(header, new Uint8Array());
        const { header: parsedHeader, payloadBuffer } = parseHybridMessage<typeof header>(hybrid as Buffer);

        expect(parsedHeader).toEqual(header);
        expect(payloadBuffer).toBe(null);
    });

    it('should throw error on missing header length', () => {
        const invalid = Buffer.from([]);
        expect(() => parseHybridMessage(invalid)).toThrow(/missing header length/i);
    });

    it('should throw error on incomplete header', () => {
        const headerLength = Buffer.alloc(4);
        headerLength.writeUInt32BE(10, 0);
        const invalid = Buffer.concat([headerLength, Buffer.from('short')]);
        expect(() => parseHybridMessage(invalid)).toThrow(/incomplete/i);
    });

    it('should throw error on invalid JSON header', () => {
        const headerLength = Buffer.alloc(4);
        const badJson = Buffer.from('{invalid}');
        headerLength.writeUInt32BE(badJson.length, 0);
        const invalid = Buffer.concat([headerLength, badJson]);
        expect(() => parseHybridMessage(invalid)).toThrow(/invalid json/i);
    });
});
