import normalizeStackTrace from '../../../../src/utils/stackTrace/normalizeStackTrace';

const originalCwd = process.cwd;

describe('normalizeStackTrace', () => {
    beforeEach(() => {
        // Reset process.cwd() before each test to prevent interference
        process.cwd = originalCwd;
    });

    it('should return undefined if the error has no stack trace', () => {
        const error = new Error('Test error');
        delete error.stack; // Remove the stack property for this test
        expect(normalizeStackTrace(error)).toBeUndefined();
    });

    it('should remove the default project root path from the stack trace', () => {
        // Simulate a project root for this test
        const mockProjectRoot = '/Users/testuser/my-ts-project';
        process.cwd = jest.fn(() => mockProjectRoot);

        const error = new Error('Sample error');
        error.stack = `Error: Sample error
    at myFunction (${mockProjectRoot}/src/utils/helper.ts:10:5)
    at anotherFunction (${mockProjectRoot}/src/index.ts:25:10)
    at Object.<anonymous> (${mockProjectRoot}/tests/main.test.ts:5:1)`;

        // For this specific test, we're adjusting the expectation for the root path
        // that's typically shown in the stack trace from `process.cwd()`.
        // The provided regex `rootPathRegex` doesn't transform the entire file path to `./`
        // but rather focuses on replacing the absolute root at the beginning of the file path.
        // Let's refine the expectation based on the function's actual current logic for direct replacement.
        const revisedExpected = `Error: Sample error
    at myFunction (./src/utils/helper.ts:10:5)
    at anotherFunction (./src/index.ts:25:10)
    at Object.<anonymous> (./tests/main.test.ts:5:1)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(revisedExpected);
    });

    it('should remove a custom provided project root path from the stack trace', () => {
        const customRoot = '/app/build';
        const error = new Error('Custom root error');
        error.stack = `Error: Custom root error
    at processFile (${customRoot}/server/processor.js:50:15)
    at handleRequest (${customRoot}/server/api.js:100:20)
    at Module._compile (internal/modules/cjs/loader.js:1138:30)`; // External path

        const expected = `Error: Custom root error
    at processFile (./server/processor.js:50:15)
    at handleRequest (./server/api.js:100:20)
    at Module._compile (internal/modules/cjs/loader.js:1138:30)`;

        const result = normalizeStackTrace(error, customRoot);
        expect(result).toEqual(expected);
    });

    it('should handle Windows style paths (backslashes) correctly', () => {
        const winRoot = 'C:\\Users\\dev\\my-windows-project';
        process.cwd = jest.fn(() => winRoot); // Mock for default root

        const error = new Error('Windows path error');
        error.stack = `Error: Windows path error
    at readFile (C:\\Users\\dev\\my-windows-project\\src\\io.ts:15:8)
    at main (C:\\Users\\dev\\my-windows-project\\app.ts:5:1)
    at anotherModule (node_modules\\external-lib\\index.js:20:2)`; // External path

        // The function normalizes root to use forward slashes for regex,
        // so the replacement should work regardless of original slash type
        const expected = `Error: Windows path error
    at readFile (./src/io.ts:15:8)
    at main (./app.ts:5:1)
    at anotherModule (node_modules/external-lib/index.js:20:2)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(expected);
    });

    it('should not modify stack trace lines that are not within the project root', () => {
        const mockProjectRoot = '/home/user/project';
        process.cwd = jest.fn(() => mockProjectRoot);

        const error = new Error('External stack trace error');
        error.stack = `Error: External stack trace error
    at internalFunction (${mockProjectRoot}/src/core.ts:30:7)
    at node_modules/library/dist/main.js:100:5
    at Function.call (<anonymous>)
    at Object.<anonymous> (/usr/local/bin/cli.js:10:1)`; // Completely outside project root

        const expected = `Error: External stack trace error
    at internalFunction (./src/core.ts:30:7)
    at node_modules/library/dist/main.js:100:5
    at Function.call (<anonymous>)
    at Object.<anonymous> (/usr/local/bin/cli.js:10:1)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(expected);
    });

    it('should handle stack traces with different line formats (e.g., anonymous functions)', () => {
        const mockProjectRoot = '/workspace/my-app';
        process.cwd = jest.fn(() => mockProjectRoot);

        const error = new Error('Format test');
        error.stack = `Error: Format test
    at /workspace/my-app/src/utils/anon.ts:5:1
    at doSomething (webpack-internal:///(app)/./src/feature.ts:10:2)
    at Module.<anonymous> (${mockProjectRoot}/src/app.ts:1:1)`;

        const expected = `Error: Format test
    at ./src/utils/anon.ts:5:1
    at doSomething (webpack-internal:///(app)/./src/feature.ts:10:2)
    at Module.<anonymous> (./src/app.ts:1:1)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(expected);
    });

    it('should correctly replace root with trailing slash in stack', () => {
        const mockProjectRoot = '/Users/user/project/'; // Note the trailing slash
        process.cwd = jest.fn(() => mockProjectRoot);

        const error = new Error('Trailing slash root');
        error.stack = `Error: Trailing slash root
    at myFunc (${mockProjectRoot}src/module.ts:10:5)`;

        const expected = `Error: Trailing slash root
    at myFunc (./src/module.ts:10:5)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(expected);
    });

    it('should handle project root matching part of an external path', () => {
        // This test case ensures that if the project root is a substring of an external path,
        // it doesn't incorrectly truncate the external path.
        const mockProjectRoot = '/common';
        process.cwd = jest.fn(() => mockProjectRoot);

        const error = new Error('Substring root');
        error.stack = `Error: Substring root
    at inCommon (${mockProjectRoot}/file.ts:1:1)
    at someExternalLib (/common-libs/dist/index.js:10:1)`; // Note /common-libs, not /common

        const expected = `Error: Substring root
    at inCommon (./file.ts:1:1)
    at someExternalLib (/common-libs/dist/index.js:10:1)`;

        const result = normalizeStackTrace(error);
        expect(result).toEqual(expected);
    });
});
