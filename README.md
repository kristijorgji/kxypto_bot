# crypto_bot

# Table of Contents

1. [Project Overview](#project-overview)
2. [Getting Started](#getting-started)
    1. [Dependencies and environment](#dependencies-and-environment)
    2. [Database setup](#database-setup)
    3. [Help](#help)
3. [CLI](#cli)
4. [Troubleshooting](#troubleshooting)
    1. [How can I find my wallet private key if I have only the recovery phrase](#how-can-i-find-my-wallet-private-key-if-i-have-only-the-recovery-phrase)
5. [Example Scripts](#example-scripts)
6. [Environmental Variables](#environmental-variables)
7. [Package.json Scripts](#packagejson-scripts)
8. [Contributing](./docs/CONTRIBUTING.md)
9. [License](#license)

# Project Overview

This crypto bot is using

* typescript
* jest
* lint and fix tools using my personal best standards
  from https://www.npmjs.com/package/@kristijorgji/eslint-config-typescript
* fully debug compatible

# Getting started

## Dependencies and environment

1. run `yarn install`
2. copy `.env.example` into `.env.` and fill in your values

It is recommended to use fast Solana nodes.

Private ones like https://chainstack.com/ work better

## Database setup

This project uses `knex` tool for migrating and seeding the database.

You can use the `package.json` commands for creating migrations, seeds or running them.

Ensure the database referred in the `.env` file exists and uses the same credentials and name.

You can create one locally for development purpose by using the attached
docker-file [docker-compose.yml](docker%2Fdocker-compose.yml)

```shell
cd docker
cp .env.example .env
docker-compose up -d
```

After you have the database up and running, you can run the migrations:

```shell
yarn migrate:latest
```

This will create all the tables

## Help

You can use `Makefile` for common development actions.

There is more knowledge about different domains under [docs](docs).

# CLI

This project offers a cli for the most frequently needed standalone commands

Run

```shell
ts-node src/console/cli.ts
```

to see list of available commands

# Troubleshooting

## How can I find my wallet private key if I have only the recovery phrase

You can run the helper CLI command

**walletInfo:solana**

```shell
 ts-node src/console/cli.ts walletInfo:solana --recoveryPhrasePath=k --provider=TrustWallet
```

# Example scripts

The folder `src/examples` contains `standalone` scripts that you can run.
They use the specified `.env` variables

# Standalone scripts

The folder `src/scripts` contains `standalone` scripts that you can run.

The difference between the example script is that these scripts here have a clear purpose and are useful, not just
demonstrative
They use the specified `.env` variables

Example:

```shell
ts-node src/scripts/pumpfun-bot.ts
```

# Environmental variables

This project uses also `dotenv` so you can create `.env` file and specify your variables and will be used by the index
file

# Package.json scripts

you can run them by `yarn commmand` or `npm run command`

| Command | Description                                                                                                          |
|---------|----------------------------------------------------------------------------------------------------------------------|
| test    | run jest tests under __tests__ directory                                                                             |
| start   | starts the code using ts-node, also can be used under intellJ under debug mode to develop and debug at the same time |
| compile | compiles the code so you can execute it as plain node if don't want to use start command                             |
| lint    | lints your code and fails if some issue is found                                                                     |
| fix     | makes changes to your code to fix the styling issues and whatever other fixable code standard                        |

# Contributing

See the [docs/Contributing](./docs/CONTRIBUTING.md) file.

# License

This project is licensed under the **Proprietary License - Restricted Access**. By using this software, you agree to the
terms and conditions of this license.

For more details, see the [LICENSE](./LICENSE.md) file.
