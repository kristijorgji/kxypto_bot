/**
 * Normalize optional fields for protobuf serialization.
 *
 * In TypeScript/JavaScript, MySQL may return `null` for fields that are nullable.
 * When using ts-proto (or protobuf in general), `null` values can be serialized as the string "null",
 * which is usually not desired. Protobuf expects `undefined` for unset optional fields.
 *
 * This function iterates over the specified fields and replaces any `null` values with `undefined`,
 * ensuring correct protobuf encoding and avoiding sending `"null"` strings over the wire.
 *
 * @param rows - Array of objects fetched from the database.
 * @param fields - List of keys on each object to normalize (`null` → `undefined`).
 * @returns The same array of rows with the specified fields normalized in place.
 */
export function normalizeOptionalFieldsInArray<T extends Record<string, unknown>, K extends keyof T>(
    rows: T[],
    fields: K[],
): T[] {
    for (const row of rows) {
        normalizeOptionalFields(row, fields);
    }
    return rows;
}

export function normalizeOptionalFields<T extends Record<string, unknown>, K extends keyof T>(item: T, fields: K[]): T {
    for (const field of fields) {
        if (item[field] === null) {
            item[field] = undefined as unknown as T[K];
        }
    }

    return item;
}
