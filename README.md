# Emplence Backend

A minimal **Node.js (JavaScript)** backend built with the **MVC** pattern, a **PostgreSQL 18**
connection over TLS, and a single REST endpoint (`GET /hello`) that confirms the service is up.

## Project Overview

This service is intentionally small and focused:

- Express application split into **routes → controllers → models** with a dedicated **config** layer.
- A PostgreSQL connection pool created from an environment-provided service URI.
- A database connectivity check performed **at startup**, so misconfiguration fails fast with a clear message.
- One REST endpoint, `GET /hello`, returning a fixed JSON message.
- No frontend, no extra business logic, no tables created (the connection test runs `SELECT version()`).

## Technology Stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Runtime        | Node.js 18+ (verified on Node.js 24)               |
| Language       | JavaScript (CommonJS)                              |
| Framework      | Express 5                                          |
| Database       | PostgreSQL 18 (`pg` driver, connection pool)       |
| Migrations     | Plain SQL files + `npm run db:migrate` runner       |
| Password hash  | `bcryptjs` (bcrypt algorithm, cost 10 by default)   |
| Configuration  | `dotenv` (environment variables)                   |
| Architecture   | MVC (Model-View-Controller)                        |
| API style      | RESTful JSON API                                   |

## Project Folder Structure

```text
emplence-backend/
├── src/
│   ├── app.js                      # Express app: middleware, routes, 404 + error handlers
│   ├── server.js                   # Bootstrap: env, DB check, role seeding, HTTP server
│   ├── config/
│   │   ├── env.js                  # Loads .env.local then .env (or ENV_FILE)
│   │   └── db.js                   # PostgreSQL pool, TLS/SSL config, withTransaction()
│   ├── controllers/
│   │   └── helloController.js      # Handles GET /hello
│   ├── database/
│   │   ├── migrate.js              # Migration runner (tracks schema_migrations)
│   │   ├── seed.js                 # Idempotent default-role seeding
│   │   └── migrations/
│   │       ├── 001_create_master_companies.sql
│   │       ├── 002_create_master_roles.sql
│   │       ├── 003_create_companies_locations.sql
│   │       ├── 004_create_users.sql
│   │       └── 005_seed_master_roles.sql
│   ├── models/
│   │   ├── companyModel.js         # master_companies
│   │   ├── roleModel.js            # master_roles (+ ensureDefaultRoles)
│   │   ├── companyLocationModel.js # companies_locations
│   │   ├── userModel.js            # users (bcrypt hashing, EMPLOYEE role)
│   │   └── databaseModel.js        # startup connection ping
│   ├── routes/
│   │   ├── index.js                # Route table
│   │   └── helloRoutes.js          # /hello routes
│   ├── utils/
│   │   └── errors.js               # HTTP-aware app errors + PostgreSQL error mapping
│   └── views/                      # Reserved; responses are JSON (no templates needed)
├── docker-compose.yml              # Local PostgreSQL 18 container (development only)
├── DATABASE_DESIGN.md              # Schema, relationships, ER diagram, migration policy
├── LOCAL_SETUP.md                  # Step-by-step local Docker command reference
├── .env.example                    # Production/hosted template (TLS required)
├── .env.local.example              # Local Docker template (TLS disabled)
├── .gitignore                      # Ignores node_modules, .env*, certificates
├── package.json
└── README.md
```

**Layering rules**

- `routes` only declare URL → controller mappings.
- `controllers` build the HTTP response and never import the database directly.
- `models` own all SQL/database access (parameterized queries, transactions, FK validation).
- `config` owns connection/SSL settings read from environment variables.

## Prerequisites

- **Node.js 18+** and **npm** (`node --version`, `npm --version`).
- Either Docker (for the bundled local database) **or** a reachable **PostgreSQL 18** instance with a
  service URI (`postgresql://USER:PASSWORD@HOST:PORT/default`).
- Network access from your machine to the database host/port.

## Installation

```bash
# 1. Install dependencies
npm install

# 2a. Local development against the bundled Docker database (no TLS)
cp .env.local.example .env.local

# 2b. OR production/hosted database (TLS required)
cp .env.example .env     # then paste your real service URI into DATABASE_URL

# 3. Create/upgrade the database schema (idempotent, safe to re-run)
npm run db:migrate
```

`npm install` installs the runtime dependencies: `express`, `pg`, `dotenv`, `bcryptjs`.

## Environment Files (local vs production)

The app loads **`.env.local` first, then `.env`**; the first value found for a variable wins.
This lets one checkout hold both configurations:

| File                 | Purpose                                  | TLS setting           | Committed? |
| -------------------- | ---------------------------------------- | --------------------- | ---------- |
| `.env.local.example` | Template for local Docker database       | `DB_SSL_MODE=disable` | Yes        |
| `.env.local`         | Your local overrides (copy of the above) | no TLS                | **No**     |
| `.env.example`       | Template for production/hosted database  | `DB_SSL_MODE=require` | Yes        |
| `.env`               | Your deployment values (URI, CA bundle)  | TLS required          | **No**     |

- Startup logs which files were used: `[env] loaded .env.local, .env`.
- To force a single file, set `ENV_FILE`: `ENV_FILE=.env.production npm start`.
- Only `*.example` files are tracked by Git; real `.env*` files, credentials and certificates are not.


## Environment Variable Configuration

All credentials come from env files (never hardcoded, never committed).

| Variable                     | Required | Default   | Description                                                                 |
| ---------------------------- | -------- | --------- | --------------------------------------------------------------------------- |
| `PORT`                       | No       | `3000`    | HTTP port the API listens on.                                               |
| `NODE_ENV`                   | No       | –         | Free-form environment label (`development`, `production`, ...).             |
| `DATABASE_URL`               | **Yes**  | –         | PostgreSQL 18 service URI, database name `default`.                         |
| `DB_SSL_MODE`                | No       | `require` | `require` enables TLS with certificate validation; `disable` turns TLS off. |
| `DB_SSL_REJECT_UNAUTHORIZED` | No       | `true`    | Verify the provider certificate chain. Keep `true` in production.           |
| `DB_SSL_CA`                  | No       | –         | Inline provider CA bundle (PEM). Escape newlines as `\n`.                   |
| `DB_SSL_CA_PATH`             | No       | –         | Path to a provider CA bundle file (PEM).                                    |
| `DB_CONNECT_TIMEOUT_MS`      | No       | `10000`   | Connection attempt timeout in milliseconds.                                 |
| `SERVER_HOST`                | No       | all interfaces | Bind address; `127.0.0.1` limits access to this machine.              |
| `BCRYPT_SALT_ROUNDS`         | No       | `10`      | bcrypt cost factor used when hashing user passwords.                        |
| `ENV_FILE`                   | No       | –         | Load one explicit env file instead of `.env.local` + `.env`.                |

Example `.env.local` (local Docker, no TLS):

```dotenv
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://emplence:emplence@localhost:5433/default
DB_SSL_MODE=disable
```

Example `.env` (production / hosted, TLS required):

```dotenv
PORT=3000
NODE_ENV=production

DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/default?sslmode=require

DB_SSL_MODE=require
DB_SSL_REJECT_UNAUTHORIZED=true
# DB_SSL_CA_PATH=./certs/provider-ca.pem
DB_CONNECT_TIMEOUT_MS=10000
```

> URL-encode reserved characters in the password (for example `@` → `%40`, `#` → `%23`).
> A password containing a raw `@` or `#` makes an invalid URI and startup fails with
> `DATABASE_URL is not a valid PostgreSQL connection URI.`

## Local Development with Docker (PostgreSQL 18, no TLS)

> Full command-by-command walkthrough (install → database → API → verification → cleanup):
> **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

`docker-compose.yml` runs PostgreSQL 18 on host port **5433** (so an existing local PostgreSQL on
`5432` keeps working; override with `LOCAL_DB_PORT`). The stock image serves **no TLS**, which is why
the local template uses `DB_SSL_MODE=disable`.

```bash
# 1. Start the database (creates database `default`, user/password emplence/emplence)
npm run db:up                                  # = docker compose up -d
# or choose another host port: LOCAL_DB_PORT=5432 docker compose up -d

# 2. Create local env values (first time only)
cp .env.local.example .env.local

# 3. Start the API
npm start
```

Expected startup log:

```text
[env] loaded .env.local, .env
[db] connected to "default" - PostgreSQL 18.6 ... 64-bit
[db] ssl: disabled (DB_SSL_MODE=disable)
[server] listening on http://localhost:3000
```

Verify and manage the container:

```bash
curl http://localhost:3000/hello
npm run db:down                  # stop, keep data
docker compose down -v           # stop and delete the data volume (fresh start)
docker compose logs -f postgres  # container logs
docker exec -it emplence-postgres18 psql -U emplence -d default
```

Equivalent one-liner without Compose:

```bash
docker run -d --name emplence-postgres18 -p 5433:5432 \
  -e POSTGRES_USER=emplence -e POSTGRES_PASSWORD=emplence -e POSTGRES_DB=default \
  postgres:18
```

> Already have your own PostgreSQL container on `5432` (for example `postgres18`)? Either point
> `DATABASE_URL` in `.env.local` at it (`postgresql://USER:PASSWORD@localhost:5432/default`) with
> `DB_SSL_MODE=disable`, or stop it and use the Compose service on `5433`.

### Access from an Android phone on the same Wi-Fi

The API listens on all interfaces by default, so no code change is needed — only the Mac's LAN IP:

```bash
ipconfig getifaddr en0     # -> e.g. 192.168.1.22
npm start                  # logs: [server] reachable on your network: http://192.168.1.22:3000
```

On the phone: `http://192.168.1.22:3000/hello`.
Emulator: `http://10.0.2.2:3000/hello`. USB instead of Wi-Fi: `adb reverse tcp:3000 tcp:3000`
then use `http://localhost:3000/hello`. Android apps need `usesCleartextTraffic` for plain HTTP
in debug builds.

Full troubleshooting: [LOCAL_SETUP.md §16](LOCAL_SETUP.md#16-access-hello-from-an-android-phone-on-the-same-wi-fi).

## PostgreSQL 18 Connection Setup

1. Copy the service URI from your provider (Neon, Supabase, Render, Azure, RDS, or self-hosted).
   The database name must be `default`.
2. Put it in `DATABASE_URL` inside `.env` (production/hosted, TLS required) or `.env.local`
   (local Docker, no TLS). See [Environment Files](#environment-files-local-vs-production).
3. Start the app (`npm start`). On boot, `src/server.js`:
   - logs the env files it loaded (`[env] loaded ...`),
   - builds the pool configuration in `src/config/db.js`,
   - runs `SELECT version(), current_database()` through `src/models/databaseModel.js`,
   - logs the server version and TLS summary, then begins listening:

     ```text
     [db] connected to "default" - PostgreSQL 18.6 ... 64-bit
     [db] ssl: enabled (rejectUnauthorized=true, ca=system)
     [server] listening on http://localhost:3000
     ```

4. If the connection fails, the process logs the reason and exits with code `1` instead of
   serving traffic with a broken database.

Pool settings: max 10 clients, 30 s idle timeout, `DB_CONNECT_TIMEOUT_MS` connect timeout,
and an idle-client error listener that prevents unexpected crashes.
## Database Schema

Schema is versioned in `src/database/migrations/` and applied with `npm run db:migrate`
(recorded in the `schema_migrations` table, so re-running is a no-op).

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `master_companies` | Registered companies (root table) | PK `id`, UNIQUE `company_code` |
| `master_roles` | Available user roles (`ADMIN`, `EMPLOYEE`) | PK `id`, UNIQUE `role_code` |
| `companies_locations` | Branches/offices of a company | PK `id`, FK `company_id` → `master_companies`, UNIQUE (`company_id`, `location_code`) |
| `users` | Accounts with hashed passwords + assignment | PK `id`, UNIQUE `username` (+ case-insensitive), FKs `role_id`, `company_id`, `location_id` |

All four tables share `is_valid BOOLEAN NOT NULL DEFAULT TRUE` and
`dt_entry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`, and use
`id BIGINT GENERATED ALWAYS AS IDENTITY` primary keys.

Model layer (`src/models/`): `companyModel`, `roleModel`, `companyLocationModel`, `userModel`.
They use parameterized SQL, `withTransaction()` for multi-step writes, validate foreign keys before
inserting, and map constraints to HTTP-friendly errors (`src/utils/errors.js`).

Database-level rules worth knowing:

- `userModel.register()` hashes passwords with bcrypt and always assigns `EMPLOYEE`; a role cannot be
  supplied by the caller, so public registration can never create an `ADMIN`.
- A user's `location_id` is rejected unless it belongs to the supplied `company_id`
  (and the database also enforces `location_id ⇒ company_id`).
- Default roles are seeded idempotently (`ON CONFLICT (role_code) DO NOTHING`) by migration `005`,
  at startup, and by `npm run db:seed`.

Full column list, ER diagram, and the migration/backward-compatibility policy live in
**[DATABASE_DESIGN.md](DATABASE_DESIGN.md)**.



## SSL Configuration Details

TLS is **on by default** (`DB_SSL_MODE=require`) with **certificate validation enabled**
(`DB_SSL_REJECT_UNAUTHORIZED=true`). Behaviour by scenario:

- **Public CA chains** (most managed providers): no extra configuration. Node verifies the
  provider certificate against its trust store.
- **Private/self-signed CA**: point `DB_SSL_CA_PATH` at the provider's CA PEM file, or paste the
  PEM into `DB_SSL_CA` with newlines escaped as `\n`. It is passed to `pg` as `ssl.ca`.
- **Validation stays on**: certificate checks are skipped only when
  `DB_SSL_REJECT_UNAUTHORIZED=false` is set explicitly, and the app logs a warning at startup in
  that case. Use it only for trusted local databases.
- **Local database without TLS**: set `DB_SSL_MODE=disable`; any other value is rejected with an
  error, so an unknown mode can never silently downgrade security.

Implementation notes:

- `getSslSummary()` logs `rejectUnauthorized` plus whether the CA comes from the system store or a
  custom bundle (it never logs credentials).
- The `pg` driver lets an `sslmode` query parameter override explicitly passed TLS options, so
  `sslmode` is stripped from `DATABASE_URL` and the `DB_SSL_*` variables remain the single source
  of truth. Keeping `?sslmode=require` in the URI is therefore harmless and optional.

## Available REST API Endpoints

### `GET /hello`

Returns a JSON message confirming the backend is running.

**Request**

```bash
curl http://localhost:3000/hello
```

**Response — `200 OK`**

```json
{
  "message": "Hello! Backend is running successfully."
}
```

Unknown routes return JSON as well.

**Response — `404 Not Found`** (`GET /does-not-exist`)

```json
{
  "message": "Route GET /does-not-exist not found."
}
```

Unexpected server errors return `500` with `{ "message": "Internal server error." }`, while the
underlying details are written to the server log only.

## Commands to Run the Application

| Command         | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `npm install`   | Install dependencies.                                            |
| `npm start`     | Start the API (`node src/server.js`).                            |
| `npm run dev`   | Start with Node's built-in watcher (`node --watch`) for reloads. |
| `npm run db:up` | Start the local PostgreSQL 18 container (`docker compose up -d`). |
| `npm run db:down` | Stop the local container, keeping its data volume.             |
| `npm run db:migrate` | Apply pending SQL migrations from `src/database/migrations/`. |
| `npm run db:seed` | Insert the default roles (`ADMIN`, `EMPLOYEE`) if missing.     |

Quick verification:

```bash
npm start
# in a second terminal
curl http://localhost:3000/hello
```

## Troubleshooting Common Database Connection Issues

| Symptom (startup log) | Likely cause and fix |
| --------------------- | -------------------- |
| `DATABASE_URL is not set` | `.env` is missing or empty; run `cp .env.example .env` and fill it in. |
| `DATABASE_URL is not a valid PostgreSQL connection URI` | Credentials contain unencoded special characters, or the scheme is missing (`postgresql://`). URL-encode the username/password. |
| `unable to verify the first certificate` / `self-signed certificate in certificate chain` | The provider uses a CA missing from Node's trust store. Set `DB_SSL_CA_PATH` (or `DB_SSL_CA`) to the provider CA bundle. Do not disable validation as a workaround. |
| `connect ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND` | Wrong host/port, database down, or firewall/network restriction. Confirm the host allows your IP and the port is reachable. |
| `password authentication failed for user ...` | Wrong credentials in `DATABASE_URL`, or the user cannot access database `default`. |
| `database "default" does not exist` | The provider has no `default` database; create it or correct the path segment of `DATABASE_URL`. |
| `The server does not support SSL connections` | `DB_SSL_MODE=require` points at a server without TLS — typical for a local Docker database. Use `.env.local` from `.env.local.example` (which sets `DB_SSL_MODE=disable`), or use the provider's TLS endpoint for hosted databases. |
| `timeout expired` / `Connection terminated due to connection timeout` | Slow or unreachable host; raise `DB_CONNECT_TIMEOUT_MS` and check provider IP allowlists. |
| `Unsupported DB_SSL_MODE "..."` | Typo in `DB_SSL_MODE`; allowed values are `require` and `disable`. |
| `Unable to read DB_SSL_CA_PATH at ...` | The CA file path is wrong or unreadable; use an absolute path or fix permissions. |
| `EADDRINUSE` (port already in use) | Another process (often a previous run) is using `PORT`; stop it or set a different `PORT`. |

Diagnostics that do not expose secrets:

```bash
# Is the database port reachable?
nc -vz YOUR_HOST 5432

# Inspect the TLS chain presented by the provider
openssl s_client -connect YOUR_HOST:5432 -starttls postgres -showcerts </dev/null
```

## Git Conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`refactor:`, `docs:`, `chore:`. `.env`, credentials, and certificate files are git-ignored;
only `.env.example` is tracked.

