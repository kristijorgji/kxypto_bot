/* eslint-disable @typescript-eslint/no-unused-vars */

export const measureExecutionTime = jest.fn(
    async <T>(fn: () => Promise<T>, functionName: string, config?: { storeImmediately: boolean }): Promise<T> => {
        return fn();
    },
);
