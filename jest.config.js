process.env.TZ = 'UTC';

const TS_CONFIG_PATH = './tsconfig.json';
const SRC_PATH = '<rootDir>';

module.exports = {
    "testEnvironment": "node",
    "preset": "ts-jest",
    setupFilesAfterEnv: ['<rootDir>/jest-setup.js',],
    "testMatch": [
        "**/__tests__/**/*.test.ts"
    ],
    "collectCoverage": true,
    "collectCoverageFrom": [
        "src/**/*.{js,jsx,ts,tsx}",
        "__tests__/**/*.{js,jsx,ts,tsx}",
        "!<rootDir>/node_modules/"
    ],
    "coverageThreshold": {
        "global": {
            "branches": 90,
            "functions": 100,
            "lines": 94.73,
            "statements": 95.12
        }
    },
    moduleNameMapper: {
        ...makeModuleNameMapper(SRC_PATH, TS_CONFIG_PATH),
    },
};

function makeModuleNameMapper(srcPath, tsconfigPath) {
    // Get paths from tsconfig
    const { paths } = require(tsconfigPath).compilerOptions;

    const aliases = {};

    // Iterate over paths and convert them into moduleNameMapper format
    Object.keys(paths || {}).forEach((item) => {
        const key = item.replace('/*', '/(.*)');
        const path = paths[item][0].replace('/*', '/$1');
        aliases[key] = srcPath + '/' + path;
    });

    return aliases;
}
