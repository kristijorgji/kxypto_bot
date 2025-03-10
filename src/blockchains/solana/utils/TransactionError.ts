export default class TransactionError extends Error {
    public logs?: string[];
    public errorLogs?: string[];

    constructor(message: string, logs?: string[]) {
        super(message);
        this.name = 'TransactionError';
        this.logs = logs;

        if (logs) {
            this.errorLogs = logs.filter(
                log =>
                    log.includes('failed') ||
                    log.includes('error') ||
                    log.includes('Error') ||
                    log.includes('exceeded'),
            );
        }
    }

    toString(): string {
        let result = `${this.name}: ${this.message}`;
        if (this.errorLogs && this.errorLogs.length > 0) {
            result += `\nError details:\n${this.errorLogs.join('\n')}`;
        }
        return result;
    }
}
