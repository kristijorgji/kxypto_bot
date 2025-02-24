import { createLogger, format, transports } from 'winston';

const IS_CLI_MODE = true;

export const logger = createLogger({
    level: process.env.LOG_LEVEL || 'verbose',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.errors({ stack: true }),
        format.splat(),
        ...(IS_CLI_MODE
            ? [
                  format.printf(({ timestamp, level, message, stack, ...rest }) => {
                      if (Object.prototype.hasOwnProperty.call(rest, 'contextMap')) {
                          if (
                              (rest as { contextMap: { listenerId: string; tokenMint?: string } }).contextMap?.tokenMint
                          ) {
                              const { listenerId, tokenMint } = (
                                  rest as { contextMap: { listenerId: string; tokenMint: string } }
                              ).contextMap;

                              return `${timestamp} [${level.toUpperCase()}][${listenerId}][${tokenMint}]: ${
                                  stack || message
                              }`;
                          }
                      }

                      return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
                  }),
              ]
            : [format.json()]),
    ),
    transports: [
        new transports.Console(),
        new transports.File({ dirname: 'logs', filename: `app_${getTimestamp()}.log` }),
    ],
});

// yyyy-mm-dd-hh-mm-ss
function getTimestamp(): string {
    const now = new Date();

    const pad = (num: number) => String(num).padStart(2, '0'); // Ensures two-digit format

    return (
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
        `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    );
}
