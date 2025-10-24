/**
 * Reviver function for `JSON.parse` that automatically converts ISO 8601 date strings
 * (e.g. "2021-03-19T10:00:00.000Z") into real `Date` objects.
 *
 * This function is called recursively by `JSON.parse` for every key–value pair
 * in the parsed object structure (including nested objects and arrays).
 *
 * It enables deep automatic date conversion when reading JSON fixtures or other
 * serialized data, ensuring that parsed objects behave like actual runtime objects
 * without manual date conversions.
 *
 * Example:
 * ```ts
 * const data = JSON.parse(jsonString, reviveDates);
 * // All ISO date strings inside `data` are now real Date instances.
 * ```
 *
 * @param _key - The current property key being processed by `JSON.parse`.
 * @param value - The value associated with the current key.
 * @returns A `Date` instance if the value is an ISO date string; otherwise, the original value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reviveDates(_key: string, value: any) {
    // Simple ISO 8601 UTC date check
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        return new Date(value);
    }

    return value;
}
