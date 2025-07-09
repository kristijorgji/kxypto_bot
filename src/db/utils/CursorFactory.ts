import CompositeCursor from './CompositeCursor';

export class CursorFactory {
    private static LAST_PREVIOUS_ID_KEY = 'lastPreviousId';
    private static LAST_DATE_KEY = 'lastDate';

    public static formCursor({ lastPreviousId, lastDate }: { lastPreviousId: string; lastDate: string }): string {
        const data = {
            [CursorFactory.LAST_PREVIOUS_ID_KEY]: lastPreviousId,
            [CursorFactory.LAST_DATE_KEY]: lastDate,
        };

        return Buffer.from(JSON.stringify(data)).toString('base64');
    }

    public static decodeCursor(cursor: string): CompositeCursor {
        const decodedData = Buffer.from(cursor, 'base64').toString('utf-8');
        const parsedData = JSON.parse(decodedData);

        return new CompositeCursor({
            lastPreviousId: parsedData[CursorFactory.LAST_PREVIOUS_ID_KEY],
            lastDate: parsedData[CursorFactory.LAST_DATE_KEY],
        });
    }
}
