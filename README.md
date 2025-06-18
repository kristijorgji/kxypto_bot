# 🤖 crypto_bot

---

## 📑 Table of Contents

1. [📘 Project Overview](#-project-overview)
2. [🚀 Getting Started](#-getting-started)
    1. [🔧 Dependencies and Environment](#-dependencies-and-environment)
    2. [🗄️ Database Setup](#-database-setup)
    3. [❓ Help](#-help)
3. [🖥️ CLI](#-cli)
4. [🌐 Server](#-server)
5. [📜 Example Scripts](#-example-scripts)
6. [🧪 Scratch Code](#-scratch-code-scratch)
7. [🛠️ Troubleshooting](#-troubleshooting)
    1. [🔑 Wallet Private Key Recovery From Secret Phrase](#-how-can-i-find-my-wallet-private-key-if-i-have-only-the-recovery-phrase)
8. [📦 Package.json Scripts](#-packagejson-main-scripts)
9. [🤝 Contributing](./docs/CONTRIBUTING.md)
10. [📄 License](#-license)

---

## 📘 Project Overview

This crypto bot is built using:

- TypeScript
- Jest
- Lint and fix tools using my personal best standards from  
  [`@kristijorgji/eslint-config-typescript`](https://www.npmjs.com/package/@kristijorgji/eslint-config-typescript)
- Fully debug compatible
- Express for the api

### ✨ Features

- Pump.fun bot
- Multiple trading strategies implemented
- Strategy backtesting framework

---

## 🚀 Getting Started

### 🔧 Dependencies and Environment

1. Run `yarn install`
2. Copy `.env.example` to `.env` and fill in your values
3. Configure `.env.test` for running tests with Jest

**Tip:** Use fast Solana nodes. Private nodes like [Chainstack](https://chainstack.com/) tend to perform better.

### 🗄️ Database Setup

This project uses **Knex** for migrating and seeding the MySQL database.

Use `package.json` scripts to create/run migrations and seeds.

Ensure the database defined in your `.env` file exists and credentials are correct.

You can create a database locally for development purpose by using the attached
docker-file [docker-compose.yml](docker%2Fdocker-compose.yml)

```shell
cd docker
cp .env.example .env
docker-compose up -d
```

Then, apply migrations:

```shell
yarn migrate:latest
```

This creates all required tables.

### ❓ Help

Use the provided `Makefile` for common dev tasks.  
Additional documentation is available under the [`docs`](docs) folder.

## 🖥️ CLI

Run standalone commands via:

```shell
ts-node src/console/cli.ts
```

This will show a list of all available CLI commands.

---

## 🌐 Server

This project includes an Express server with endpoints for:

- Login
- Logout
- Refreshing access tokens
- More endpoints coming soon

in order to manage remotely the bot.

📂 Server entry point:  
[`src/http-api/server.ts`](src/http-api/server.ts)

---

## 📜 Example Scripts

The `src/examples` folder contains simple, standalone demo scripts.

These scripts rely on environment variables defined in your project’s `.env` file. There are two ways to ensure these
variables are loaded:

- **Preferred (Explicit Import):**  
  At the top of your script, import the custom environment loader:
  ```ts
  import '@src/core/loadEnv';
  ```
  This ensures consistent `.env` loading using your project's root marker logic.

- **Alternative (Runtime Require):**  
  When running the script via `ts-node`, preload `dotenv/config`:
  ```bash
  ts-node -r dotenv/config src/examples/myScript.ts
  ```
  This method works for quick tests but doesn't support custom `.env` resolution logic (e.g., `.root` marker).

**Example:**

```shell
ts-node src/examples/getExchangeRate.ts
```

---

## 🛠️ Standalone Scripts

The `src/scripts` folder contains standalone scripts with real utility (not just examples).

These scripts rely on environment variables defined in your project’s `.env` file. There are two ways to ensure these
variables are loaded:

- **Preferred (Explicit Import):**  
  At the top of your script, import the custom environment loader:
  ```ts
  import '@src/core/loadEnv';
  ```
  This ensures consistent `.env` loading using your project's root marker logic.

- **Alternative (Runtime Require):**  
  When running the script via `ts-node`, preload `dotenv/config`:
  ```bash
  ts-node -r dotenv/config src/scripts/backtest-strategy.ts
  ```
  This method works for quick tests but doesn't support custom `.env` resolution logic (e.g., `.root` marker).

Examples:

**[backtest-strategy.ts](src/scripts/pumpfun/backtest-strategy.ts)**

Run this script to test your defined strategy(ies) against the backtest history files

With existing backtest:

```shell
ts-node -r dotenv/config src/scripts/pumpfun/backtest-strategy.ts --backtestId=existingBacktestId
```

Without existing backtest, it will create one automatically with the specified config:

```shell
ts-node -r dotenv/config src/scripts/pumpfun/backtest-strategy.ts
```

**Run the pumpfun bot**

```shell
ts-node src/scripts/pumpfun/bot.ts
```

---

## 🧪 Scratch Code (`.scratch/`)

The `.scratch` folder is a local workspace for prototyping, experimenting, and testing ideas.  
It’s intentionally **excluded from version control** via `.gitignore`, so you can freely write temporary scripts without
affecting the repository.

- Use it for quick experiments (e.g., queries, utility tests, isolated logic).
- You can import code from the main `src/` directory.
- TypeScript is configured to support this folder (see [tsconfig.json](tsconfig.json)).

> ⚠️ Note: Since `.scratch/` is not committed, avoid placing any important or long-term code here.

---

## 🛠️ Troubleshooting

### 🔑 How can I find my wallet private key if I have only the recovery phrase?

Run the following CLI command:

**walletInfo:solana**

```shell
 ts-node src/console/cli.ts walletInfo:solana --recoveryPhrasePath=k --provider=TrustWallet
```

---

## 📦 Package.json Main Scripts

Run using `yarn <command>` or `npm run <command>`:

| Command | Description                                                     |
|---------|-----------------------------------------------------------------|
| test    | Run Jest tests under the `__tests__` directory                  |
| start   | Run code using ts-node (useful with IntelliJ debug mode)        |
| compile | Compile the code to plain Node.js (for running without ts-node) |
| lint    | Lint your code and fail on violations                           |
| fix     | Automatically fix style and code standard issues                |

---

## 🤝 Contributing

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md).

---

## 📄 License

This project is licensed under the **Proprietary License - Restricted Access**. By using this software, you agree to the
terms and conditions of this license.

See [LICENSE](./LICENSE.md) for details.
