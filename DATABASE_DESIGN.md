# Database Design — Emplence Backend

Schema, relationships and operational rules for the PostgreSQL 18 database used by this backend.
This document is part of the deliverable set and **must be updated whenever the schema or
relationships change**.

- [A. Database Configuration](#a-database-configuration)
- [B. Table Documentation](#b-table-documentation)
- [C. Entity Relationships](#c-entity-relationships)
- [D. Initial Master Data](#d-initial-master-data)
- [E. Future Database Changes](#e-future-database-changes)

## A. Database Configuration

| Item | Value |
| --- | --- |
| Database engine | **PostgreSQL 18** (verified against 18.6) |
| Database name | `default` |
| Driver | `pg` (node-postgres) with a single shared connection pool |
| Connection configuration | `src/config/db.js` (pool + TLS), `src/config/env.js` (env-file loading) |
| Schema creation | SQL migrations in `src/database/migrations/`, applied by `npm run db:migrate` |
| Migration bookkeeping | `schema_migrations` table (`name` PK, `applied_at`) |
| Master data seeding | `roleModel.ensureDefaultRoles()` on startup, migration `005`, and `npm run db:seed` |

### Connection string

The database is reached through a **service URI** held in the `DATABASE_URL` environment variable,
for example `postgresql://USER:PASSWORD@HOST:5432/default`. Credentials are **never** stored in
source code or documentation; they live only in the git-ignored `.env` / `.env.local` files.

### Environment variables (database related)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | – | PostgreSQL 18 service URI; database segment must be `default` |
| `DB_SSL_MODE` | No | `require` | `require` = TLS + certificate validation, `disable` = no TLS (local Docker only) |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | `true` | Verify the provider certificate chain |
| `DB_SSL_CA` | No | – | Inline PEM CA bundle (newlines escaped as `\n`) for private/self-signed CAs |
| `DB_SSL_CA_PATH` | No | – | Path to a PEM CA bundle on disk |
| `DB_CONNECT_TIMEOUT_MS` | No | `10000` | Pool connection timeout |
| `BCRYPT_SALT_ROUNDS` | No | `10` | bcrypt cost factor used by `userModel.register` |
| `ENV_FILE` | No | – | Load one explicit env file instead of `.env.local` + `.env` |

### SSL configuration

- TLS is **on by default** (`DB_SSL_MODE=require`) with `rejectUnauthorized: true`; certificate
  validation is never disabled implicitly.
- Any `sslmode` parameter in `DATABASE_URL` is stripped so the `DB_SSL_*` variables remain the
  single source of truth (in `pg`, a URI `sslmode` would otherwise override explicit TLS options).
- Hosted providers with a private CA: set `DB_SSL_CA_PATH` (or `DB_SSL_CA`) to that CA bundle.
- Local development database in Docker (no TLS): `DB_SSL_MODE=disable` via `.env.local`
  (see `.env.local.example`).

### Connection initialization sequence

`src/server.js` runs these steps on boot; any failure is logged and the process exits with code `1`
(except the "schema missing" case, which only warns):

1. `src/config/env.js` loads `.env.local` then `.env` (or `ENV_FILE`).
2. The pool is created lazily from `DATABASE_URL` + TLS options (`src/config/db.js`).
3. `databaseModel.ping()` runs `SELECT version(), current_database()` to prove connectivity.
4. `roleModel.ensureDefaultRoles()` seeds/verifies the default roles (idempotent).
5. The HTTP server starts listening.

Pool defaults: max 10 clients, 30 s idle timeout, `DB_CONNECT_TIMEOUT_MS` connect timeout, plus an
`error` listener on idle clients so an unexpected socket error cannot crash the process.

## B. Table Documentation

All four business tables share the same conventions:

- `id BIGINT GENERATED ALWAYS AS IDENTITY` — surrogate primary key.
- `is_valid BOOLEAN NOT NULL DEFAULT TRUE` — soft-delete/inactive flag (records are never physically deleted by the app).
- `dt_entry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` — creation timestamp (no timezone; stored in UTC by the server).

### B.1 `master_companies`

**Purpose:** master information of registered companies. Parent table of `companies_locations` and `users`.

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `company_name` | `VARCHAR(255)` | No | – | Company name, must not be blank |
| `company_code` | `VARCHAR(50)` | No | – | Unique company code, must not be blank |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Record validity |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_master_companies (id)`
- **Unique constraint:** `uq_master_companies_company_code (company_code)`
- **Check constraints:** `chk_master_companies_company_name_not_blank`, `chk_master_companies_company_code_not_blank`
- **Foreign keys:** none (root table)
- **Referenced by:** `companies_locations.company_id`, `users.company_id`

### B.2 `master_roles`

**Purpose:** roles available to application users. Managed exclusively by backend code — no public role-creation API exists.

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `role_name` | `VARCHAR(100)` | No | – | Display name (`Administrator`, `Employee`) |
| `role_code` | `VARCHAR(50)` | No | – | Unique, stable code (`ADMIN`, `EMPLOYEE`) used by code |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Record validity |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_master_roles (id)`
- **Unique constraint:** `uq_master_roles_role_code (role_code)`
- **Check constraints:** `chk_master_roles_role_name_not_blank`, `chk_master_roles_role_code_not_blank`
- **Foreign keys:** none
- **Referenced by:** `users.role_id` (NOT NULL)
- **Seed data:** `Administrator`/`ADMIN` and `Employee`/`EMPLOYEE` (migration `005`, see section D)


### B.3 `companies_locations`

**Purpose:** branches, offices and premises of a company (one company → many locations).

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `company_id` | `BIGINT` | No | – | FK → `master_companies.id` |
| `location_name` | `VARCHAR(255)` | No | – | Branch/premises name, must not be blank |
| `location_code` | `VARCHAR(50)` | No | – | Location code, unique **within its company** |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Record validity |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_companies_locations (id)`
- **Foreign key:** `fk_companies_locations_company (company_id)` → `master_companies (id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`
- **Unique constraint:** `uq_companies_locations_company_code (company_id, location_code)` — the same location code may exist in different companies
- **Check constraints:** `chk_companies_locations_location_name_not_blank`, `chk_companies_locations_location_code_not_blank`
- **Indexes:** `idx_companies_locations_company_id (company_id)` for "all locations of a company" lookups
- **Referenced by:** `users.location_id`
- **Business rule:** `companyLocationModel.create()` verifies the company exists and `is_valid = TRUE` before inserting (clear 400 instead of a raw FK error).

### B.4 `users`

**Purpose:** application users with hashed credentials and organizational assignment.

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `username` | `VARCHAR(100)` | No | – | Unique (also unique case-insensitively), must not be blank |
| `password` | `VARCHAR(255)` | No | – | bcrypt hash — never plain text |
| `role_id` | `BIGINT` | No | – | FK → `master_roles.id`; assigned by backend logic |
| `company_id` | `BIGINT` | **Yes** | – | FK → `master_companies.id`; nullable while a user has no organization |
| `location_id` | `BIGINT` | **Yes** | – | FK → `companies_locations.id`; requires `company_id` |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Record validity |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_users (id)`
- **Unique constraints:**
  - `uq_users_username (username)` — exact uniqueness
  - `uq_users_username_lower (lower(username))` — case-insensitive uniqueness, so `Admin` and `admin` cannot both exist
- **Foreign keys:**
  - `fk_users_role (role_id)` → `master_roles (id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`
  - `fk_users_company (company_id)` → `master_companies (id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`
  - `fk_users_location (location_id)` → `companies_locations (id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`
- **Check constraints:**
  - `chk_users_username_not_blank`, `chk_users_password_not_blank`
  - `chk_users_location_requires_company (location_id IS NULL OR company_id IS NOT NULL)`
- **Indexes:** `idx_users_role_id`, `idx_users_company_id`, `idx_users_location_id`
- **Backend-enforced rules (`userModel`):**
  - Public registration resolves the `EMPLOYEE` role server-side and accepts **no** role input, so nobody can self-assign `ADMIN`.
  - Passwords are hashed with `bcryptjs` (cost `BCRYPT_SALT_ROUNDS`, default 10) before the insert; the hash is never returned by model reads.
  - When both `companyId` and `locationId` are supplied, the location must belong to that company **and** both must be `is_valid`; otherwise the write is rejected with `400` inside the same transaction.
  - `locationId` without `companyId` is rejected before touching the database.
  - All queries use parameter placeholders (`$1`, `$2`, …) — no string interpolation of values.


## C. Entity Relationships

All relationships are **one-to-many** and are enforced by foreign keys with
`ON UPDATE CASCADE ON DELETE RESTRICT` (a referenced row cannot be deleted while dependants exist).

| # | Parent | Child | Foreign key column | Cardinality | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `master_companies` | `companies_locations` | `companies_locations.company_id` | 1 : N | A company has many branches/premises; every location needs an existing company |
| 2 | `master_roles` | `users` | `users.role_id` (NOT NULL) | 1 : N | One role is assigned to many users; every user must have a role |
| 3 | `master_companies` | `users` | `users.company_id` (nullable) | 1 : N | A company has many users; assignment may happen after registration |
| 4 | `companies_locations` | `users` | `users.location_id` (nullable) | 1 : N | A location can host many users; requires `company_id` |

```mermaid
erDiagram
    master_companies ||--o{ companies_locations : has
    master_companies ||--o{ users : employs
    master_roles ||--o{ users : assigned_to
    companies_locations ||--o{ users : assigned_to

    master_companies {
        bigint id PK
        varchar company_name
        varchar company_code UK
        boolean is_valid
        timestamp dt_entry_date
    }

    master_roles {
        bigint id PK
        varchar role_name
        varchar role_code UK
        boolean is_valid
        timestamp dt_entry_date
    }

    companies_locations {
        bigint id PK
        bigint company_id FK
        varchar location_name
        varchar location_code
        boolean is_valid
        timestamp dt_entry_date
    }

    users {
        bigint id PK
        varchar username UK
        varchar password
        bigint role_id FK
        bigint company_id FK
        bigint location_id FK
        boolean is_valid
        timestamp dt_entry_date
    }
```

> `companies_locations.location_code` is unique **per company** (`company_id, location_code`), not
> globally — see the unique constraint in section B.3.

**Referential integrity split**

- The database guarantees that `company_id`, `role_id` and `location_id` point at existing rows, and
  that a location entered on a user row always carries a company (`chk_users_location_requires_company`).
- The model layer guarantees the cross-table rule "the location belongs to the chosen company" and
  that referenced rows are `is_valid = TRUE` before writing. A single foreign key cannot express
  that pairing because it spans two columns of `companies_locations`; an optional hardening step
  (composite foreign key) is described in section E.


## D. Initial Master Data

Two roles are created by the schema/seed process:

| `role_name` | `role_code` | Meaning |
| --- | --- | --- |
| `Administrator` | `ADMIN` | Full administrative access; must never be granted through public registration |
| `Employee` | `EMPLOYEE` | Default role for every self-registered user |

`id` values are generated by the identity column, so never hard-code `1`/`2` in code — always
resolve roles by `role_code`.

### How the roles are created (triple safety, all idempotent)

1. **Migration** `005_seed_master_roles.sql`:
   ```sql
   INSERT INTO master_roles (role_name, role_code)
   VALUES ('Administrator', 'ADMIN'), ('Employee', 'EMPLOYEE')
   ON CONFLICT (role_code) DO NOTHING;
   ```
2. **Application startup** — `roleModel.ensureDefaultRoles()` runs on every boot with the same
   `ON CONFLICT (role_code) DO NOTHING` insert, so a fresh or partially prepared database still ends
   up with both roles, and repeated restarts never create duplicates (verified: the table keeps
   exactly two rows).
3. **Manual/CI seeding** — `npm run db:seed` calls the same model function.

Because `role_code` carries a UNIQUE constraint, "duplicate on restart" is impossible at the database
level as well.

### Adding more roles

Roles are **backend-controlled only** — there is no public endpoint and no model method that creates
roles. To introduce a new role:

1. Add a migration (for example `006_add_manager_role.sql`) with
   `INSERT INTO master_roles (role_name, role_code) VALUES ('Manager', 'MANAGER') ON CONFLICT (role_code) DO NOTHING;`
2. Reference it in code by `role_code` (`roleModel.findByCode('MANAGER')`), never by numeric id.
3. If the role must not be self-assignable, keep it out of `userModel.register()`, which always
   resolves `EMPLOYEE` and does not accept a role argument.
4. Apply with `npm run db:migrate` and update this document.

Because of `ON CONFLICT DO NOTHING` and the existing UNIQUE constraint, adding a role can be repeated
safely in every environment.


## E. Future Database Changes

### Migration rules (apply to every change)

1. **Never modify the database by hand** (no ad-hoc `psql` DDL in shared environments). The schema
   lives in `src/database/migrations/` and is applied with `npm run db:migrate`.
2. **Never edit an already-applied migration file**; add a new file instead. Applied files are
   recorded in `schema_migrations`, so an edited file would silently drift from reality.
3. Name files `NNN_short_description.sql` (zero-padded, e.g. `006_add_user_email.sql`). Lexicographic
   order is the execution order.
4. Each migration runs **inside one transaction** together with its `schema_migrations` row:
   schema change and bookkeeping either both apply or neither does.
5. Migrations are **forward-only**. To undo something, write a compensating migration; do not delete
   history.
6. Test the migration on a local Docker database first (`docker compose down -v && npm run db:migrate`
   for a clean run, plus a run against a copy of production-like data).
7. Back up production before applying, then run `npm run db:migrate` as a deploy step **before**
   starting the new application version.

### Adding a new column

- Additive and nullable first — this is backward compatible with the running application:
  ```sql
  -- 006_add_user_email.sql
  ALTER TABLE users ADD COLUMN email VARCHAR(255);
  ```
- Populate data in the same or a later migration (batched updates for large tables).
- Only then enforce the constraint in a **separate** migration, after existing rows are valid:
  ```sql
  -- 007_enforce_user_email.sql
  ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);
  ```
- Adding a `NOT NULL` column to a populated table requires a `DEFAULT` (or a backfill) in the same
  statement.
- Update the matching model and section B of this document in the same change set.

### Creating a new master table

1. Create `NNN_create_<table>.sql` with the shared conventions:
   `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
   `is_valid BOOLEAN NOT NULL DEFAULT TRUE`,
   `dt_entry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`.
2. Add explicit constraint names (`pk_`, `uq_`, `fk_`, `chk_`) and indexes for every foreign key
   column, because PostgreSQL does not index FK columns automatically.
3. Add a model in `src/models/<name>Model.js` using the shared pool/`withTransaction` from
   `src/config/db.js`, parameterized queries, and `src/utils/errors.js` for status mapping.
4. If the table holds seedable master data, seed it with `INSERT ... ON CONFLICT DO NOTHING` (a
   migration plus, if the app depends on it at boot, an `ensure*` model function).
5. Document the table here (section B) and add it to the ER diagram (section C).

### Adding a foreign key relationship

1. Make sure the referencing column is nullable (or already populated consistently) to keep the
   change backward compatible.
2. Clean orphan rows before adding the constraint: `SELECT ... WHERE child.parent_id NOT IN (...)`
   or `NOT EXISTS`.
3. Add the constraint with documented behaviour:
   ```sql
   ALTER TABLE child
     ADD CONSTRAINT fk_child_parent
     FOREIGN KEY (parent_id) REFERENCES parent (id)
     ON UPDATE CASCADE ON DELETE RESTRICT;
   ```
4. Index the referencing column (`CREATE INDEX idx_child_parent_id ON child (parent_id);`).
5. Keep `ON DELETE RESTRICT` as the default policy; soft deletes via `is_valid` are preferred over
   cascading deletes of business data.
6. Validate the relationship in the model before inserting so callers get a clear `400` rather than a
   driver error, mirroring `companyLocationModel.create()` and `userModel.register()`.
7. Add the relationship to section C (table + Mermaid diagram).

### Modifying existing constraints

- **Unique:** add a *new* unique index/constraint (optionally `CONCURRENTLY` for large production
  tables) after de-duplicating data; drop the old one in a separate migration.
- **Check:** add as `NOT VALID`, then `VALIDATE CONSTRAINT` once existing rows pass — this avoids a
  long exclusive lock.
- **Nullable → NOT NULL:** backfill first, then `ALTER COLUMN ... SET NOT NULL` in a separate
  migration; do not combine with a data-update migration.
- **Type changes:** add a new column with the target type, dual-write/backfill, switch reads, then drop
  the old column in a later release.

### Maintaining backward compatibility

- **Expand → migrate → contract**: add new structures first, migrate data, switch the application,
  remove old structures only after no deployed version uses them.
- Keep API responses additive; never rename/remove a column that a deployed application version reads
  in the same release that introduces the replacement.
- Prefer new nullable columns, defaults and new tables over in-place rewrites.
- Deploy ordering: **migration first, then application** (new code must tolerate the old and new
  schema during a rolling deploy).
- After every schema change, run `npm run db:migrate` twice — the second run must report
  `database is up to date`; that confirms the migration bookkeeping is consistent.
- Keep `DATABASE_DESIGN.md`, `README.md` and the `.env.example` in sync with the change in the same
  pull request.

### Optional hardening: location must belong to company (database level)

Today the pairing is enforced in `userModel.register()`. If it must be enforced by the database too:

```sql
ALTER TABLE companies_locations
  ADD CONSTRAINT uq_companies_locations_id_company UNIQUE (id, company_id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_location_company
  FOREIGN KEY (location_id, company_id) REFERENCES companies_locations (id, company_id);
```

The application-level check should be kept regardless, so users receive a readable validation message.

