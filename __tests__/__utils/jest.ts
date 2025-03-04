export const waitForVariable = (getVariable: () => number, target: number, timeout: number = 5000) => {
    return new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
            if (getVariable() === target) {
                clearInterval(interval);
                resolve();
            }
        }, 100); // Check every 100ms

        setTimeout(() => {
            clearInterval(interval);
            reject(new Error('Timeout reached while waiting for variable'));
        }, timeout); // Timeout if the value is not reached in 5 seconds
    });
};
