export function isRunningIntegrationTests(): boolean {
    const testPath = process.argv[process.argv.length - 1];
    const isRunningAllTests = !testPath || testPath === '' || testPath.includes('.bin/jest');

    return isRunningAllTests || testPath.includes('integration/') || testPath.endsWith('__tests__/');
}
