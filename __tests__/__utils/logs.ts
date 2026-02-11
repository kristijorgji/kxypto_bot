import { LogEntry } from 'winston';

/**
 * Sanitizes log strings by removing dynamic timestamps and ANSI color codes.
 * Useful for comparing log output against static fixtures in tests.
 */
export function sanitizeLogs(logs: string[] | LogEntry[]): string[] {
    // 1. Regex to match timestamps like "2026-02-10 17:49:37 "
    const timestampRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /;

    // 2. Regex to match ANSI escape codes (colors)
    // eslint-disable-next-line no-control-regex
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

    return logs.map(log => {
        const line = typeof log === 'string' ? log : log.message || '';
        return line.replace(timestampRegex, '').replace(ansiRegex, '').trim();
    });
}
