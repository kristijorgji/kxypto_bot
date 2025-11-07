/**
 * Trims a string to a specified maximum length.
 * If the string exceeds the maxLength, it is truncated and an ellipsis (...) is appended.
 *
 * @param str The input string to trim.
 * @param maxLength The maximum allowed length of the string (including the ellipsis if added).
 * @returns The trimmed string.
 */
export function trimAtMaxLength(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
        return str;
    } else if (maxLength <= 3) {
        // Handle cases where maxLength is too small for ellipsis
        return str.slice(0, maxLength);
    } else {
        return str.slice(0, maxLength - 3) + '...';
    }
}
