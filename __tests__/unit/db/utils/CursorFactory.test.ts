import CompositeCursor from '../../../../src/db/utils/CompositeCursor';
import { CursorFactory } from '../../../../src/db/utils/CursorFactory';

describe('CursorFactory', () => {
    const mockCursorData = {
        lastPreviousId: '12345',
        lastDate: '2025-07-09 10:15:52',
    };

    it('should encode the cursor data correctly into base64', () => {
        const encoded = CursorFactory.formCursor(mockCursorData);
        const decodedString = Buffer.from(encoded, 'base64').toString('utf-8');
        const parsed = JSON.parse(decodedString);

        expect(parsed.lastPreviousId).toBe(mockCursorData.lastPreviousId);
        expect(parsed.lastDate).toBe(mockCursorData.lastDate);
    });

    it('should decode the cursor correctly into a CompositeCursor instance', () => {
        const encoded = CursorFactory.formCursor(mockCursorData);
        const cursor = CursorFactory.decodeCursor(encoded);

        expect(cursor).toBeInstanceOf(CompositeCursor);
        expect(cursor.lastPreviousId).toBe(mockCursorData.lastPreviousId);
        expect(cursor.lastDate).toBe(mockCursorData.lastDate);
    });

    it('should encode and decode symmetrically', () => {
        const encoded = CursorFactory.formCursor(mockCursorData);
        const decoded = CursorFactory.decodeCursor(encoded);

        expect(decoded).toMatchObject(mockCursorData);
    });

    it('should throw an error if decoding an invalid base64 string', () => {
        expect(() => {
            CursorFactory.decodeCursor('not-a-valid-cursor');
        }).toThrow();
    });
});
