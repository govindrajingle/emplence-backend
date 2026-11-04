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

Authentication variables (`JWT_SECRET`, `AUTH_TOKEN_TTL_SECONDS`, `ADMIN_API_KEY`, `BCRYPT_SALT_ROUNDS`)
are application-level and documented in [README.md](README.md#environment-variable-configuration);
they do not change the database schema.

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

**Purpose:** roles available to application users. Roles are either **global** (`company_id IS NULL`,
seeded: `ADMIN`, `EMPLOYEE`) or **owned by one company**, created by that company's sub-admin.

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `role_name` | `VARCHAR(100)` | No | – | Display name (`Administrator`, `Supervisor`, ...) |
| `role_code` | `VARCHAR(50)` | No | – | Stable code (`ADMIN`, `EMPLOYEE`, `SUPERVISOR`, ...) used by code |
| `company_id` | `BIGINT` | **Yes** | – | `NULL` = global role; otherwise owning company (FK) |
| `hierarchy_level` | `INTEGER` | No | `100` | Lower value = **more** authority; `ADMIN` = 1 |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Record validity |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_master_roles (id)`
- **Unique constraint:** `uq_master_roles_company_code (company_id, role_code)` **NULLS NOT DISTINCT** — a code is unique within its company, and global codes stay unique among themselves (so two companies can both own a `SUPERVISOR` role)
- **Foreign key:** `fk_master_roles_company (company_id)` → `master_companies (id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`
- **Check constraints:** `chk_master_roles_role_name_not_blank`, `chk_master_roles_role_code_not_blank`, `chk_master_roles_hierarchy_level (hierarchy_level > 0)`
- **Indexes:** `idx_master_roles_company_id (company_id)`
- **Referenced by:** `users.role_id` (NOT NULL)
- **Seed data:** global `Administrator`/`ADMIN` (`hierarchy_level = 1`) and `Employee`/`EMPLOYEE` (`100`) — migration `005` + `006`, see section D
- **Write access:** only through authenticated `ADMIN` actors — a company sub-admin is limited to its own company and to subordinate hierarchy levels

**Role catalogue (migration `007`)** — lower `hierarchy_level` = more authority:

| `role_code` | `role_name` | `hierarchy_level` | Scope | Permissions |
| --- | --- | ---: | --- | --- |
| `ADMIN` | Administrator | 100 | global | `USER_CREATE`, `USER_VIEW`, `USER_UPDATE`, `USER_DELETE` |
| `OWNER` | Owner | 200 | global template, used with a company | all four |
| `MANAGER` | Manager | 250 | global template, used with a company | all four |
| `CLEANER`, `DRIVER`, `OFFICE_BOY`, `SECURITY_GUARD`, `RECEPTIONIST`, `EMPLOYEE` | employee categories | 300 | global templates | none |

Company-specific roles are also supported: `company_id` is set and `(company_id, role_code)` stays
unique, so two companies may each own a `SUPERVISOR` (level ≥ 250) row. The hierarchy check is what
restricts *who* may be managed — identical permissions do **not** mean identical authority.


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
| `role_id` | `BIGINT` | No | – | FK → `master_roles.id`; assigned by backend logic (`ADMIN` + `company_id` = company sub-admin) |
| `company_id` | `BIGINT` | **Yes** | – | FK → `master_companies.id`; nullable while a user has no organization |
| `location_id` | `BIGINT` | **Yes** | – | FK → `companies_locations.id`; requires `company_id` |
| `created_by_user_id` | `BIGINT` | **Yes** | – | Self-FK → `users.id`; who created the account (`NULL` for historical rows) |
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
  - `fk_users_created_by (created_by_user_id)` → `users (id)`, `ON UPDATE CASCADE ON DELETE SET NULL`
- **Check constraints:**
  - `chk_users_username_not_blank`, `chk_users_password_not_blank`
  - `chk_users_location_requires_company (location_id IS NULL OR company_id IS NOT NULL)`
- **Indexes:** `idx_users_role_id`, `idx_users_company_id`, `idx_users_location_id`, `idx_users_created_by_user_id`
- **Backend-enforced rules (`userModel` + `authorizationService`):**
  - Public registration resolves the `EMPLOYEE` role server-side and accepts **no** role input, so nobody can self-assign `ADMIN`.
  - Passwords are hashed with `bcryptjs` (cost `BCRYPT_SALT_ROUNDS`, default 10) before the insert; the hash is never returned by model reads.
  - When both `companyId` and `locationId` are supplied, the location must belong to that company **and** both must be `is_valid`; otherwise the write is rejected with `400` inside the same transaction.
  - `locationId` without `companyId` is rejected before touching the database.
  - `created_by_user_id` is filled from the authenticated actor (never from the request body), so
    Owner→Manager and Manager→Employee chains are auditable; historical rows keep `NULL`.
  - All queries use parameter placeholders (`$1`, `$2`, …) — no string interpolation of values.

### B.5 `role_permissions`

**Purpose:** explicit permission grants per role (migration `007`). Permissions answer *what* a role may
do; `hierarchy_level` answers *whom* it may act on. Both are required.

| Column | Data type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT` | No | identity | Primary key |
| `role_id` | `BIGINT` | No | – | FK → `master_roles.id` (`ON DELETE CASCADE`) |
| `permission_code` | `VARCHAR(100)` | No | – | `USER_CREATE`, `USER_VIEW`, `USER_UPDATE`, `USER_DELETE` |
| `is_valid` | `BOOLEAN` | No | `TRUE` | Revoking sets this to `FALSE` (row is kept for audit) |
| `dt_entry_date` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Creation timestamp |

- **Primary key:** `pk_role_permissions (id)`
- **Unique constraint:** `uq_role_permissions_role_code (role_id, permission_code)`
- **Foreign key:** `fk_role_permissions_role (role_id)` → `master_roles (id)`, `ON UPDATE CASCADE ON DELETE CASCADE`
- **Check constraint:** `chk_role_permissions_code_not_blank`
- **Index:** `idx_role_permissions_code (permission_code)`
- **Seeded matrix (migration `007`, applies to every role with `hierarchy_level < 300`):**

  | Role | `USER_CREATE` | `USER_VIEW` | `USER_UPDATE` | `USER_DELETE` |
  | --- | --- | --- | --- | --- |
  | Administrator (100) | ✅ | ✅ | ✅ | ✅ |
  | Owner (200) | ✅ | ✅ | ✅ | ✅ |
  | Manager (250) | ✅ | ✅ | ✅ | ✅ |
  | Employee / Cleaner / Driver / … (300) | – | – | – | – |

  Grants are inserted with `ON CONFLICT (role_id, permission_code) DO NOTHING`, so re-running the
  migration never duplicates rows. Newly created roles start **without** permissions and are granted
  explicitly via `PUT /api/roles/:id/permissions` (platform administrator only).


## C. Entity Relationships

All relationships are **one-to-many** and are enforced by foreign keys with
`ON UPDATE CASCADE ON DELETE RESTRICT` (a referenced row cannot be deleted while dependants exist).

| # | Parent | Child | Foreign key column | Cardinality | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `master_companies` | `companies_locations` | `companies_locations.company_id` | 1 : N | A company has many branches/premises; every location needs an existing company |
| 2 | `master_roles` | `users` | `users.role_id` (NOT NULL) | 1 : N | One role is assigned to many users; every user must have a role |
| 3 | `master_companies` | `users` | `users.company_id` (nullable) | 1 : N | A company has many users (sub-admins and staff); assignment may happen after registration |
| 4 | `companies_locations` | `users` | `users.location_id` (nullable) | 1 : N | A location can host many users; requires `company_id` |
| 5 | `master_companies` | `master_roles` | `master_roles.company_id` (nullable) | 1 : N | A company owns its own roles (e.g. `SUPERVISOR`); `NULL` marks a global role |
| 6 | `master_roles` | `role_permissions` | `role_permissions.role_id` | 1 : N | A role has several permission grants (`USER_CREATE`, …) |
| 7 | `users` | `users` | `users.created_by_user_id` (nullable) | 1 : N | Audit chain: who created which account (Owner → Manager → Employee) |

```mermaid
erDiagram
    master_companies ||--o{ companies_locations : has
    master_companies ||--o{ users : employs
    master_companies ||--o{ master_roles : owns
    master_roles ||--o{ users : assigned_to
    master_roles ||--o{ role_permissions : grants
    companies_locations ||--o{ users : assigned_to
    users ||--o{ users : created

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
        varchar role_code
        bigint company_id FK
        integer hierarchy_level
        boolean is_valid
        timestamp dt_entry_date
    }

    role_permissions {
        bigint id PK
        bigint role_id FK
        varchar permission_code
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
        bigint created_by_user_id FK
        boolean is_valid
        timestamp dt_entry_date
    }
```

> `master_roles.role_code` is unique **per company** (`company_id, role_code`, `NULLS NOT DISTINCT`),
> `companies_locations.location_code` is unique per company, and `role_permissions` is unique per
> `(role_id, permission_code)` — see sections B.2, B.3 and B.5.

**Referential integrity split**

- The database guarantees that `company_id`, `role_id` and `location_id` point at existing rows, and
  that a location entered on a user row always carries a company (`chk_users_location_requires_company`).
- The model layer guarantees the cross-table rule "the location belongs to the chosen company" and
  that referenced rows are `is_valid = TRUE` before writing. A single foreign key cannot express
  that pairing because it spans two columns of `companies_locations`; an optional hardening step
  (composite foreign key) is described in section E.


## D. Initial Master Data

Global role templates (`company_id IS NULL`) are created by the schema/seed process:

| `role_name` | `role_code` | `hierarchy_level` | Scope | Meaning |
| --- | --- | --- | --- | --- |
| `Administrator` | `ADMIN` | `100` | global | Platform administrator: all companies, all permissions |
| `Owner` | `OWNER` | `200` | global template | Company owner: manages managers and employees of its company |
| `Manager` | `MANAGER` | `250` | global template | Manages employee-level users of its company |
| `Employee` | `EMPLOYEE` | `300` | global template | Default self-registration role; no management rights |
| `Cleaner`, `Driver`, `Office Boy`, `Security Guard`, `Receptionist` | `CLEANER`, `DRIVER`, `OFFICE_BOY`, `SECURITY_GUARD`, `RECEPTIONIST` | `300` | global templates | Employee categories (same level as `EMPLOYEE`, no permissions) |

`id` values are generated by the identity column, so never hard-code them — always resolve roles by
`role_code` inside a company scope (`roleModel.findByCode(code, { companyId })`).

### How the roles are created (idempotent, safe on every environment)

1. **Migration `005`** seeded `ADMIN`/`EMPLOYEE`; **`006`** added `company_id`/`hierarchy_level`;
   **`007`** normalises the known codes to `ADMIN=100`, `OWNER=200`, `MANAGER=250`, `EMPLOYEE=300`
   and inserts the missing templates (`MANAGER`, `CLEANER`, …) with
   `ON CONFLICT (company_id, role_code) DO NOTHING`.
2. **Application startup** — `roleModel.ensureDefaultRoles()` re-inserts `ADMIN`/`EMPLOYEE` as global
   roles with the same `ON CONFLICT` clause, so a fresh or partially prepared database still ends up
   with both, and restarts never create duplicates.
3. **Manual/CI seeding** — `npm run db:seed` calls the same model function.

### Permission grants

`role_permissions` holds the grants; `007` grants all four `USER_*` permissions to every role with
`hierarchy_level < 300` (ADMIN, OWNER, MANAGER and any custom role below employee level) and nothing to
employee-level roles. Grants are `ON CONFLICT (role_id, permission_code) DO NOTHING`, so the seed is
repeatable. Newly created roles start without permissions and are granted explicitly by the platform
administrator (`PUT /api/roles/:id/permissions`).

**Permissions ≠ authority:** Owner and Manager both hold `USER_CREATE`, but the hierarchy check
(`actor.hierarchyLevel < targetRole.hierarchyLevel`) still stops a Manager from creating another
Manager or touching an Owner.

### Company-specific roles

- `company_id` is nullable: `NULL` = global template (usable by any company), otherwise the role is
  owned by one company.
- `(company_id, role_code)` is unique with `NULLS NOT DISTINCT`, so two companies may each own a
  `SUPERVISOR` (level ≥ 250) row while global codes stay unique.
- A global actor may create roles for a company (`POST /api/roles { companyId }`); the company's own
  roles are only visible to its users (`GET /api/roles` returns global roles + own company roles).

```sql
-- example: a company-specific role for company 34
INSERT INTO master_roles (role_name, role_code, company_id, hierarchy_level)
VALUES ('Supervisor', 'SUPERVISOR', 34, 250)
ON CONFLICT (company_id, role_code) DO NOTHING;
```

### User creation workflow (who creates whom)

| Actor | May create | Company written | `created_by_user_id` |
| --- | --- | --- | --- |
| `ADMIN` (global) | any role in any company, including `OWNER`/`MANAGER` | request value or `NULL` | admin user id (`NULL` for bootstrap key) |
| `OWNER` (company 34) | `MANAGER` (250), `EMPLOYEE`/`CLEANER`/… (300) | forced `34` | owner user id |
| `MANAGER` (company 34) | `EMPLOYEE`/`CLEANER`/`DRIVER`/… (300) | forced `34` | manager user id |
| `EMPLOYEE` and other level-300 roles | – (no permissions) | – | – |

Creation is validated in this order: permission (`USER_CREATE`) → company access → role active and in
scope → hierarchy (`actor.hierarchyLevel < role.hierarchy_level`) → insert with `created_by_user_id`
inside one transaction.

### Adding more roles

Role/permission writes are **platform-administrator only** (`assertPlatformAdministrator`); company
users cannot create roles. To add a **global** role in every environment:

1. Add a migration (for example `008_add_auditor_role.sql`) with
   `INSERT INTO master_roles (role_name, role_code, company_id, hierarchy_level) VALUES ('Auditor', 'AUDITOR', NULL, 150) ON CONFLICT (company_id, role_code) DO NOTHING;`
   followed by the desired `role_permissions` grants (or use `PUT /api/roles/:id/permissions`).
2. Reference it in code by `role_code` + scope, never by numeric id; the authorization logic reads
   `hierarchy_level` and permissions, so new roles need no code change.
3. Keep it out of `userModel.register()`, which always resolves `EMPLOYEE` and accepts no role argument.
4. Apply with `npm run db:migrate` and update this document.


## E. Future Database Changes

### Migration `007_hierarchical_permissions.sql` — applied changes & manual review

Applied safely (no `DROP`/`TRUNCATE`, idempotent, existing rows preserved):

1. `users.created_by_user_id BIGINT` + `fk_users_created_by … ON DELETE SET NULL` + index —
   historical users keep `NULL`.
2. Known global roles normalised: `ADMIN=100`, `OWNER=200`, `MANAGER=250`, `EMPLOYEE=300`.
3. Missing global templates inserted (`MANAGER`, `CLEANER`, `DRIVER`, `OFFICE_BOY`,
   `SECURITY_GUARD`, `RECEPTIONIST`) with `ON CONFLICT (company_id, role_code) DO NOTHING`.
4. `role_permissions` created (`UNIQUE (role_id, permission_code)`, FK cascade) and the four
   `USER_*` grants applied to every role with `hierarchy_level < 300`.

**Deliberately not automated (review these manually):**

- **Custom/legacy roles** (`SELECT id, role_code, company_id, hierarchy_level FROM master_roles WHERE hierarchy_level NOT IN (100,200,250,300);`)
  keep their existing level — changing unknown roles could silently alter authority. Reassign them a
  level from the catalogue if needed, with `UPDATE master_roles SET hierarchy_level = … WHERE id = …`.
- **Existing company owners** already on `OWNER` (like user 38) need no data change: authority is
  derived from the role level, not stored on the user.
- **Company-specific copies** of OWNER/MANAGER are not created automatically. If a company must own
  its own role row, insert it with `company_id` set; global templates already cover the standard flow.
- **Permissions for custom roles** are not granted automatically; assign them explicitly:
  `PUT /api/roles/:id/permissions { "permissions": ["USER_VIEW"] }`.
- **Passwords were not touched**, and no user's role was changed.

Rollback (if ever required) is a compensating migration: drop `role_permissions`,
drop `fk_users_created_by` + `users.created_by_user_id`, and restore the previous hierarchy numbers.
Prefer fixing forward with a new migration.

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

