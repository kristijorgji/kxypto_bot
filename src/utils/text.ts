export function trimEllip(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return value.substring(0, Math.max(maxLength - 3, 1)) + '...';
}
