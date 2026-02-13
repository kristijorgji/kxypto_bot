import { Logger } from 'winston';

export interface BacktestRunContext {
    backtestRunId: number;
    backtestId: string;
    strategyId: string;
}

export const createPrefixedLogger = <T extends object>(
    parentLogger: Logger,
    context: T,
    buildPrefix: (context: T) => string,
): Logger => {
    // Create the native child logger.
    // This ensures your metadata (IDs) is still attached for JSON/File logs.
    // const child = parentLogger.child(context);
    const child = parentLogger.child(context);

    const prefix = buildPrefix(context);

    // Return a Proxy that intercepts logging calls
    return new Proxy(child, {
        get(target, prop, receiver) {
            // Check if the property being accessed is a log method
            const logLevels = ['info', 'error', 'warn', 'debug', 'verbose', 'silly'];

            if (typeof prop === 'string' && logLevels.includes(prop)) {
                // Return a wrapped function for the log method
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (message: string | any, ...args: any[]) => {
                    if (typeof message === 'string') {
                        // INJECT THE PREFIX HERE
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        return (target as any)[prop](`${prefix}${message}`, ...args);
                    }
                    // If it's not a string (e.g. an object), pass it through unchanged
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (target as any)[prop](message, ...args);
                };
            }

            // Handle the generic 'log' method (e.g. logger.log('info', 'msg'))
            if (prop === 'log') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (level: string, message: string | any, ...args: any[]) => {
                    if (typeof message === 'string') {
                        return target.log(level, `${prefix} ${message}`, ...args);
                    }
                    return target.log(level, message, ...args);
                };
            }

            // For all other properties (e.g. logger.level, logger.format), return normally
            return Reflect.get(target, prop, receiver);
        },
    });
};
