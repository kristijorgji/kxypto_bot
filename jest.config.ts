process.env.TZ = 'UTC';

const TS_CONFIG_PATH = './tsconfig.json';
const SRC_PATH = '<rootDir>';

export default {
    testEnvironment: 'node',
    preset: 'ts-jest',
    setupFilesAfterEnv: ['<rootDir>/jest/setup.ts'],
    globalSetup: '<rootDir>/jest/globalSetup.ts',
    globalTeardown: '<rootDir>/jest/globalTeardown.ts',
    testMatch: ['**/__tests__/**/*.test.ts'],
    collectCoverage: false,
    collectCoverageFrom: [
        'src/**/*.{js,jsx,ts,tsx}',
        '!src/db/migrations/**',
        '!src/examples/**',
        '!**/__mocks__/**',
        '!<rootDir>/node_modules/',
    ],
    coverageThreshold: {
        global: {
            statements: 50,
            branches: 50,
            functions: 40,
            lines: 50,
        },
    },
    moduleNameMapper: {
        ...makeModuleNameMapper(SRC_PATH, TS_CONFIG_PATH),
    },
};

function makeModuleNameMapper(srcPath: string, tsconfigPath: string) {
    // Get paths from tsconfig
    const { paths } = require(tsconfigPath).compilerOptions;

    const aliases: Record<string, string> = {};

    // Iterate over paths and convert them into moduleNameMapper format
    Object.keys(paths || {}).forEach(item => {
        const key = item.replace('/*', '/(.*)');
        const path = paths[item][0].replace('/*', '/$1');
        aliases[key] = srcPath + '/' + path;
    });

    return aliases;
}
