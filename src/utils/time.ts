/**
 * returns it as string in this format YYYY-MM-DD
 */
export function getDateSecondsAgo(seconds: number): string {
    const date = new Date();
    date.setSeconds(date.getSeconds() - seconds);

    return date.toISOString().split('T')[0];
}
