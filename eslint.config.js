const { defineConfig } = require('eslint/config');
const baseConfig = require('@kristijorgji/eslint-config-typescript');

module.exports = defineConfig([
    ...baseConfig,
    {
        files: ['src/**/*.ts', '__tests__/**/*.ts'],
        rules: {
            ...baseConfig.rules,
            'import/no-named-as-default': 0,
        },
    },
]);
