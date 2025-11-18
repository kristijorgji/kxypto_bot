# 🤖 crypto_bot

**crypto_bot** is a state-of-the-art trading bot designed for multiple blockchains, supporting fully customizable
strategies.

**Supported chains and platforms:**

* ⛓️ **Blockchains:** Solana
* 🚀 **Launchpads:** PumpFun

**Key Features:**

* 📈 Built-in **backtesting engine** for testing strategies against historical data.
* 🔌 Easily **integrate new strategies**, including those from 3rd-party API providers.
* 🌐 Provides a **REST HTTP API server** to fetch trades, backtests, and strategy data.
* ⚡ Includes a **WebSocket server** for real-time data streaming and incremental updates.

---

## 📑 Table of Contents

1. [🧩 Tech Stack](#-tech-stack)
2. [🚀 Getting Started](#-getting-started)
    1. [🔧 Dependencies and Environment](#-dependencies-and-environment)
    2. [🗄️ Database Setup](#-database-setup)
    3. [❓ Help](#-help)
3. [🖥️ CLI](#-cli)
4. [🌐 Server](#-server)
5. [📡 WebSocket Server](#-websocket-server)
   - [🔄 Internal IPC System (Redis PubSub)](#-internal-ipc-system-redis-pubsub)
     - [Why We Need IPC](#why-we-need-ipc)
     - [🚀 IPC Features](#-ipc-features)
     - [Architecture Overview](#architecture-overview)
   - [Features](#features)
   - [File Structure](#file-structure)
   - [Generating TypeScript Types](#generating-typescript-types)
6. [📜 Example Scripts](#-example-scripts)
7. [⚙️ Standalone Scripts](#-standalone-scripts)
8. [🧪 Scratch Code](#-scratch-code-scratch)
9. [🛠️ Troubleshooting](#-troubleshooting)
    1. [🔑 Wallet Private Key Recovery From Secret Phrase](#-how-can-i-find-my-wallet-private-key-if-i-have-only-the-recovery-phrase)
10. [🤝 Contributing](./docs/CONTRIBUTING.md)
11. [📄 License](#-license)

---

## 🧩 Tech Stack

Built with a modern toolchain for speed, scalability, and developer experience:

- ⚡ [TypeScript](https://www.typescriptlang.org/) — typed superset of JavaScript for safer, scalable code
- 🧱 [Express](https://expressjs.com/) — robust HTTP server for REST APIs
- 📡 [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) — real-time streaming server
- 🧹 [ESLint](https://eslint.org/) — code linting
- 🎨 [Prettier](https://prettier.io/) — code formatting
- 🧪 [Jest](https://jestjs.io/) — testing framework for unit and integration tests
- 🛠️ [Knex](https://knexjs.org/) — SQL query builder for MySQL migrations and seeds
- 🧩 [Protocol Buffers](https://developers.google.com/protocol-buffers) — binary serialization for lightweight and typed
  messages
- 🌐 [dotenv](https://www.npmjs.com/package/dotenv) — environment variable management

---

## 🚀 Getting Started

### 🔧 Dependencies and Environment

1. Install dependencies:

```bash
yarn install
```

2. Copy and configure `.env`:

```bash
cp .env.example .env
```

3. Configure `.env.test` for running tests with Jest.

**Tip:** Use fast Solana nodes. Private providers like [Chainstack](https://chainstack.com/) often perform better.

You can now run standalone scripts under `src/scripts` or predefined scripts in `package.json`:

```bash
yarn pumpfun-bot
```

> **Note:** Always verify configuration before running live trades.

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

This project includes an **Express** server with endpoints for:

- Login
- Logout
- Refreshing access tokens
- More endpoints coming soon

in order to manage remotely the bot.

📂 Server entry point:  
[`src/http-api/server.ts`](src/http-api/server.ts)

### Request Validation & Typed Handlers

All API routes use a **Zod-powered validation system** with **fully typed request handlers**.  
It ensures safe and predictable API inputs without mutating Express internals.

📘 Read how request validation works:  
[`docs/http-api/request-validation.md`](docs/http-api/request-validation.md)

## 📡 WebSocket Server

We maintain a dedicated server at `src/ws-api/server.ts` to handle all WebSocket connections.  
This server acts as the real-time gateway of the application and is responsible for:

- Fetching initial trade/backtest data (snapshots)
- Broadcasting real-time updates to clients
- Handling subscriptions with filters and pagination
- **Routing distributed RPC responses from background processes**

### 🔄 Internal IPC System (Redis PubSub)

The WebSocket server includes a lightweight **distributed RPC mechanism** powered by Redis PubSub.  
This enables **internal Node processes** (like backtest runners) to communicate with the WebSocket server.

This IPC layer solves the problem of worker processes needing to send real-time results back to WebSocket clients.

#### Why We Need IPC

Long-running tasks (backtests, strategy engines, analytics workers) run in **separate processes**.  
They cannot directly reply to WebSocket clients.

Instead:

1. WebSocket client sends an RPC request  
2. WS server forwards the request using Redis PubSub  
3. Worker receives the request and computes the result  
4. Worker publishes a corresponding `rpc_response`  
5. WS server resolves the pending RPC and responds to the WebSocket client  

This keeps the WebSocket layer clean, scalable, and decoupled from heavy tasks.

### 🚀 IPC Features

- **Distributed RPC via Redis PubSub**
- **Correlation ID matching**
- **Plugin-based initialization (extensible IPC architecture)**
- **Fault-tolerant — no shared memory between processes**
- **Usable by any internal service (backtest, live trading, pricing, etc.)**

### Architecture Overview

```
Frontend  →  WebSocket Server  →  Redis PubSub  →  Worker Process
    ↑                 ↓                                 ↑
    └──────── rpc_response ←────────────────────────────┘
```

---

#### Features

- **Protobuf Encoding**  
  Efficient, typed binary messages.

- **Strict Typed Messages**  
  Defined in `.proto` files and compiled to TypeScript.

- **Incremental Updates**  
  Handles `added`, `updated`, `deleted` events.

- **IPC-Driven RPC**  
  Distributed services can reply to WebSocket clients through Redis.

### File Structure

```
src/
  protos/                    # Proto message definitions
  ws-api/
    server.ts                # WebSocket server entry
    configureWsApp.ts        # Plugin-based WS initialization
    ipc/                     # Redis-based IPC logic
    handlers/                # RPC + channel event handlers
```

### Generating TypeScript Types

Run the following command to generate TypeScript types from your `.proto` files:

```bash
yarn proto:generate
```

For automatic regeneration when `.proto` files change:

```bash
yarn proto:watch
```

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
  ts-node -r tsconfig-paths/register -r dotenv/config src/examples/myScript.ts
  ```
  This method works for quick tests but doesn't support custom `.env` resolution logic (e.g., `.root` marker).

**Example:**

```shell
ts-node src/examples/getExchangeRate.ts
```

---

## ⚙️️ Standalone Scripts

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
  ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/backtest-strategy.ts
  ```
  This method works for quick tests but doesn't support custom `.env` resolution logic (e.g., `.root` marker).

Examples:

**[backtest-strategy.ts](src/scripts/pumpfun/backtest-strategy.ts)**

Run this script to test your defined strategy(ies) against the backtest history files

With existing backtest:

```shell
ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/pumpfun/backtest-strategy.ts --backtestId=existingBacktestId
```

Without existing backtest, it will create one automatically with the specified config:

```shell
ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/pumpfun/backtest-strategy.ts
```

**Run the pumpfun bot**

```shell
ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/pumpfun/bot.ts
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

## 🤝 Contributing

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md).

---

## 📄 License

This project is licensed under the **Proprietary License - Restricted Access**. By using this software, you agree to the
terms and conditions of this license.

See [LICENSE](./LICENSE.md) for details.
