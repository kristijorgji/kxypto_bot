export function isRunningIntegrationTests(): boolean {
    const testPath = process.argv.slice(1).find(arg => arg.startsWith('.') || arg.startsWith('/') || arg.includes('/'));

    if (!testPath) {
        throw new Error('No valid path argument found in process.argv');
    }

    const containsIntegrationTest = process.argv.some(
        arg => arg.endsWith('__tests__/') || arg.includes('/integration') || arg.includes('integration/'),
    );

    const isRunningAllTests = !testPath || testPath === '' || testPath.includes('.bin/jest');
    const isRunningBeforeCommit = process.argv.includes('--findRelatedTests');

    return isRunningBeforeCommit || isRunningAllTests || containsIntegrationTest;
}
