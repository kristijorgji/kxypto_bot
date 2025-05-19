import { MySQLTimestamp } from '../db/types';

/**
 * returns it as string in this format YYYY-MM-DD
 */
export function getDateSecondsAgo(seconds: number): string {
    const date = new Date();
    date.setSeconds(date.getSeconds() - seconds);

    return date.toISOString().split('T')[0];
}

export function getSecondsDifference(start: Date, end: Date): number {
    return Math.abs((end.getTime() - start.getTime()) / 1000);
}

export function dateToMySQLTimestamp(date: Date): MySQLTimestamp {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function formatDateIso8601WithOffset(date: Date): string {
    const tzo = -date.getTimezoneOffset();
    const dif = tzo >= 0 ? '+' : '-';
    const pad = function (num: number) {
        return (num < 10 ? '0' : '') + num;
    };

    return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        'T' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes()) +
        ':' +
        pad(date.getSeconds()) +
        dif +
        pad(Math.floor(Math.abs(tzo) / 60)) +
        ':' +
        pad(Math.abs(tzo) % 60)
    );
}
