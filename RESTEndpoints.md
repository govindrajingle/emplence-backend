# REST Endpoints

Complete HTTP API reference for the Emplence backend. Base URL for local development:

```text
http://localhost:3000
```

On a phone/another device on the same Wi-Fi use the LAN address printed at startup
(for example `http://192.168.1.22:3000`) — see [LOCAL_SETUP.md §16](LOCAL_SETUP.md#16-access-hello-from-an-android-phone-on-the-same-wi-fi).

- [Conventions](#conventions)
- [Endpoint summary](#endpoint-summary)
- [1. GET /hello](#1-get-hello)
- [2. Companies](#2-companies)
- [3. Companies locations](#3-companies-locations)
- [4. Roles](#4-roles)
- [5. Users](#5-users)
- [Foreign key behaviour](#foreign-key-behaviour)
- [Status codes and errors](#status-codes-and-errors)

## Conventions

- **Content type:** request and response bodies are JSON (`Content-Type: application/json`).
- **IDs:** `BIGINT` identity values, sent as JSON numbers and read from path params as digits.
- **Soft delete:** rows are never removed by the API. Set `isValid: false` to deactivate a record.
- **List responses:** `{ "count": <number>, "data": [ ... ] }`.
- **Single-record responses:** `{ "data": { ... } }`.
- **List filters:** `includeInvalid=true` returns inactive rows too (default is only `is_valid = TRUE`).
- **PUT semantics:** partial update — only the fields present in the body are changed. Sending `{}` (or
  only unknown keys) returns `400`.
- **Route naming:** the locations resource is `/api/companies-locations` (plural, hyphenated).
- **Protection:** role management and privileged role assignment require the `x-admin-key` header
  whose value is the server's `ADMIN_API_KEY` environment variable.

## Endpoint summary

| # | Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/hello` | Liveness check (original endpoint) | – |
| 2 | `GET` | `/api/companies` | List companies | – |
| 3 | `POST` | `/api/companies` | Create a company | – |
| 4 | `PUT` | `/api/companies/:id` | Update a company | – |
| 5 | `GET` | `/api/companies-locations` | List locations (optionally by company) | – |
| 6 | `POST` | `/api/companies-locations` | Create a location for a company | – |
| 7 | `PUT` | `/api/companies-locations/:id` | Update a location | – |
| 8 | `GET` | `/api/roles` | List roles | – |
| 9 | `POST` | `/api/roles` | Create a role | `x-admin-key` |
| 10 | `PUT` | `/api/roles/:id` | Update a role | `x-admin-key` |
| 11 | `GET` | `/api/users` | List users (optionally by company/location) | – |
| 12 | `POST` | `/api/users` | Create a user | `x-admin-key` only for non-`EMPLOYEE` roles |
| 13 | `PUT` | `/api/users/:id` | Update a user | `x-admin-key` only for role changes to non-`EMPLOYEE` |

## 1. GET /hello

Health/liveness endpoint kept from the first iteration.

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

Unknown routes return JSON `404`:

```json
{ "message": "Route GET /api/unknown not found." }
```

## 2. Companies

### 2.1 `GET /api/companies`

Lists companies ordered by `company_name`.

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `includeInvalid` | boolean | `false` | Include rows with `is_valid = false` |

```bash
curl 'http://localhost:3000/api/companies'
curl 'http://localhost:3000/api/companies?includeInvalid=true'
```

**Response — `200 OK`**

```json
{
  "count": 1,
  "data": [
    {
      "id": 1,
      "company_name": "Acme Corp",
      "company_code": "ACME001",
      "is_valid": true,
      "dt_entry_date": "2026-11-03T13:31:07.123Z"
    }
  ]
}
```

### 2.2 `POST /api/companies`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `companyName` | string (≤255) | ✅ | must not be blank |
| `companyCode` | string (≤50) | ✅ | **unique** (`uq_master_companies_company_code`) |

```bash
curl -X POST http://localhost:3000/api/companies \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Corp","companyCode":"ACME001"}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 1,
    "company_name": "Acme Corp",
    "company_code": "ACME001",
    "is_valid": true,
    "dt_entry_date": "2026-11-03T13:31:07.123Z"
  }
}
```

Errors: `400` missing/blank name or code · `409` duplicate `companyCode`.

### 2.3 `PUT /api/companies/:id`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `companyName` | string (≤255) | No | must not be blank |
| `companyCode` | string (≤50) | No | unique |
| `isValid` | boolean | No | soft delete / reactivate |

```bash
curl -X PUT http://localhost:3000/api/companies/1 \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Corporation","isValid":true}'
```

**Response — `200 OK`** — `{ "data": { ...updated company... } }`

Errors: `400` no updatable field / invalid value · `404` company not found ·
`409` duplicate `companyCode`.

> Deactivating a company (`isValid: false`) does **not** cascade: its locations and users keep
> their rows. New locations/users can no longer reference it because the model layer checks
> `is_valid = TRUE`.


## 3. Companies locations

A location always belongs to exactly one company (`companies_locations.company_id` →
`master_companies.id`). `location_code` is unique **per company**, so `HO` may exist for two
different companies but not twice for the same one.

### 3.1 `GET /api/companies-locations`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `companyId` | integer | – | Only locations of this company |
| `includeInvalid` | boolean | `false` | Include rows with `is_valid = false` |

```bash
curl 'http://localhost:3000/api/companies-locations'
curl 'http://localhost:3000/api/companies-locations?companyId=1'
```

**Response — `200 OK`**

```json
{
  "count": 1,
  "data": [
    {
      "id": 1,
      "company_id": 1,
      "location_name": "Head Office",
      "location_code": "HO",
      "is_valid": true,
      "dt_entry_date": "2026-11-03T13:31:08.456Z"
    }
  ]
}
```

### 3.2 `POST /api/companies-locations`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `companyId` | integer | ✅ | **FK** → `master_companies.id`; must exist and be `is_valid` |
| `locationName` | string (≤255) | ✅ | must not be blank |
| `locationCode` | string (≤50) | ✅ | unique together with `companyId` |

```bash
curl -X POST http://localhost:3000/api/companies-locations \
  -H 'Content-Type: application/json' \
  -d '{"companyId":1,"locationName":"Head Office","locationCode":"HO"}'
```

**Response — `201 Created`** — `{ "data": { ...location... } }`

Errors: `400` missing field / unknown or inactive `companyId` · `409` duplicate
`(companyId, locationCode)` for that company.

### 3.3 `PUT /api/companies-locations/:id`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `locationName` | string (≤255) | No | must not be blank |
| `locationCode` | string (≤50) | No | unique within the location's company |
| `isValid` | boolean | No | soft delete / reactivate |
| `companyId` | – | ❌ | **rejected with `400`** — a location cannot be moved between companies |

```bash
curl -X PUT http://localhost:3000/api/companies-locations/1 \
  -H 'Content-Type: application/json' \
  -d '{"locationName":"Headquarters"}'
```

**Response — `200 OK`** — `{ "data": { ...location... } }`

Errors: `400` no updatable field / blank value / `companyId` supplied · `404` location not found ·
`409` duplicate `(companyId, locationCode)`.

> Why is `companyId` immutable? Users may already reference this location; moving it would break the
> invariant "a user's location belongs to the user's company". Create a new location for the other
> company instead.


## 4. Roles

Roles drive `users.role_id`. Because the project rules require roles to be managed through
backend-controlled functionality only, **create/update require the admin key**:

```bash
x-admin-key: $ADMIN_API_KEY
```

- `ADMIN_API_KEY` unset on the server → role write endpoints answer `503` (fail closed).
- Wrong/missing header → `401`.
- Reads (`GET /api/roles`) stay public so clients can display role names.

### 4.1 `GET /api/roles`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `includeInvalid` | boolean | `false` | Include rows with `is_valid = false` |

```bash
curl http://localhost:3000/api/roles
```

**Response — `200 OK`**

```json
{
  "count": 2,
  "data": [
    { "id": 1, "role_name": "Administrator", "role_code": "ADMIN", "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z" },
    { "id": 2, "role_name": "Employee", "role_code": "EMPLOYEE", "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z" }
  ]
}
```

### 4.2 `POST /api/roles` — requires `x-admin-key`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | ✅ | must not be blank |
| `roleCode` | string (≤50) | ✅ | **unique** (`uq_master_roles_role_code`); stored/compared uppercase |

```bash
curl -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Manager","roleCode":"MANAGER"}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 3,
    "role_name": "Manager",
    "role_code": "MANAGER",
    "is_valid": true,
    "dt_entry_date": "2026-11-03T13:35:12.789Z"
  }
}
```

Errors: `401` invalid admin key · `503` role management disabled · `400` missing/blank value ·
`409` duplicate `roleCode`.

### 4.3 `PUT /api/roles/:id` — requires `x-admin-key`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | No | must not be blank |
| `roleCode` | string (≤50) | No | unique |
| `isValid` | boolean | No | soft delete (users keep the role reference) |

```bash
curl -X PUT http://localhost:3000/api/roles/3 \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Operations Manager"}'
```

**Response — `200 OK`** — `{ "data": { ...role... } }`

Errors: `401` invalid admin key · `503` disabled · `400` no updatable field ·
`404` role not found · `409` duplicate `roleCode`.

> Renaming/soft-deleting `ADMIN` or `EMPLOYEE` is allowed but discouraged: the seeding logic only
> inserts missing codes, and `userModel.register()` depends on `EMPLOYEE` existing.


## 5. Users

A user row references three tables: `role_id` (required), `company_id` (optional) and `location_id`
(optional, and only valid together with a company that owns that location). Passwords are hashed with
bcrypt before insert; the hash is never returned by any endpoint.

### 5.1 `GET /api/users`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `companyId` | integer | – | Only users assigned to this company |
| `locationId` | integer | – | Only users assigned to this location |
| `includeInvalid` | boolean | `false` | Include users with `is_valid = false` |

```bash
curl http://localhost:3000/api/users
curl 'http://localhost:3000/api/users?companyId=1&locationId=1'
```

**Response — `200 OK`**

```json
{
  "count": 1,
  "data": [
    {
      "id": 1,
      "username": "jdoe",
      "role_id": 2,
      "role_code": "EMPLOYEE",
      "company_id": 1,
      "location_id": 1,
      "is_valid": true,
      "dt_entry_date": "2026-11-03T13:40:00.000Z"
    }
  ]
}
```

`role_code` comes from a join with `master_roles`; no `password` field is ever selected.

### 5.2 `POST /api/users`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | ✅ | **unique**, case-insensitive |
| `password` | string (8–72) | ✅ | stored as bcrypt hash, never returned |
| `roleCode` | string | No | default `EMPLOYEE`; any other value requires `x-admin-key` (**FK** → `master_roles.role_code`) |
| `companyId` | integer / null | No | **FK** → `master_companies.id`; must exist and be `is_valid` |
| `locationId` | integer / null | No | **FK** → `companies_locations.id`; must belong to `companyId` and be `is_valid`; requires `companyId` |

```bash
# default EMPLOYEE role (public registration path)
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"jdoe","password":"secret123"}'

# with organizational assignment
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"asmith","password":"secret123","companyId":1,"locationId":1}'

# privileged role — admin key required
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"username":"root","password":"secret123","roleCode":"ADMIN"}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 1,
    "username": "jdoe",
    "role_id": 2,
    "company_id": null,
    "location_id": null,
    "is_valid": true,
    "dt_entry_date": "2026-11-03T13:40:00.000Z"
  }
}
```

Errors: `400` validation / unknown role / unknown company / location not in company /
`locationId` without `companyId` · `401` ADMIN (or any non-EMPLOYEE) role without a valid admin key ·
`409` username already taken (case-insensitive).

### 5.3 `PUT /api/users/:id`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | No | unique (case-insensitive) |
| `password` | string (8–72) | No | re-hashed with bcrypt |
| `roleCode` | string | No | existing, valid role; non-`EMPLOYEE` requires `x-admin-key` |
| `companyId` | integer / null | No | must exist and be `is_valid` |
| `locationId` | integer / null | No | must belong to the effective company (after this update) |
| `isValid` | boolean | No | soft delete / reactivate |

```bash
curl -X PUT http://localhost:3000/api/users/1 \
  -H 'Content-Type: application/json' \
  -d '{"companyId":1,"locationId":1}'

# clear the assignment: location first, then company (order within one call is irrelevant)
curl -X PUT http://localhost:3000/api/users/1 \
  -H 'Content-Type: application/json' \
  -d '{"companyId":null,"locationId":null}'

# promote to ADMIN (admin key required)
curl -X PUT http://localhost:3000/api/users/1 \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleCode":"ADMIN"}'
```

**Response — `200 OK`** — `{ "data": { ...user... } }`

Errors: `400` no updatable field / `locationId` without company / location not in the company /
unknown role or company · `401` privileged role change without admin key · `404` user not found ·
`409` duplicate username.

> Changing only `companyId` while the user still has a location from the old company returns `400`.
> Send a new `locationId` (belonging to the new company) or `"locationId": null` in the same request.


## Foreign key behaviour

| Request field | Foreign key | Referenced table | Validated in | On violation |
| --- | --- | --- | --- | --- |
| `companyId` (locations, create) | `fk_companies_locations_company` | `master_companies.id` | model (pre-check within transaction) + DB | `400 Company {id} does not exist or is not valid.` |
| `companyId` (users, create/update) | `fk_users_company` | `master_companies.id` | model (pre-check within transaction) + DB | `400 Company {id} does not exist or is not valid.` |
| `locationId` (users) | `fk_users_location` | `companies_locations.id` | model checks id **and** that `company_id` matches + DB FK | `400 Location {id} does not belong to company {id} or is not valid.` |
| `roleCode` (users) | `fk_users_role` | `master_roles.role_code` (resolved to `id`) | model lookup + DB FK | `400 Role "{code}" does not exist or is not valid.` |
| `companyId` (locations, update) | – | – | model rule | `400 companyId cannot be changed; create a new location for the other company instead.` |

Database-level guarantees that back these up:

- `users.location_id` is nullable, but `chk_users_location_requires_company` rejects a location
  without a company.
- All foreign keys use `ON UPDATE CASCADE ON DELETE RESTRICT`: a company/role/location that is still
  referenced cannot be deleted.
- Unique constraints: `master_companies.company_code`, `master_roles.role_code`,
  `users.username` (+ `lower(username)`), `companies_locations (company_id, location_code)`.

Practical implications when building clients:

1. Create the company before its locations; create locations before assigning users to them.
2. Read ids from create responses (or `GET` lists) and send them as numbers.
3. Deactivation is `isValid: false`; assignments referencing inactive rows are refused by the model
   layer even though the row still exists.
4. Only `EMPLOYEE` can be self-assigned. Anything else needs the admin key, mirroring the rule that
   roles are managed through backend-controlled functionality only.

## Status codes and errors

| Status | Meaning in this API | Example body |
| --- | --- | --- |
| `200` | Read/update succeeded | `{ "data": { ... } }` |
| `201` | Record created | `{ "data": { ... } }` |
| `400` | Validation or foreign-key/relationship violation | `{ "message": "locationId requires companyId." }` |
| `401` | Missing/invalid `x-admin-key` for a privileged operation | `{ "message": "A valid x-admin-key header is required for this operation." }` |
| `404` | Unknown id or route | `{ "message": "User 42 was not found." }` |
| `409` | Unique constraint violation | `{ "message": "Username \"jdoe\" is already taken." }` |
| `500` | Unexpected error (details only in server logs) | `{ "message": "Internal server error." }` |
| `503` | Role management disabled (`ADMIN_API_KEY` not set) | `{ "message": "Role management is disabled. Set ADMIN_API_KEY in the environment to enable it." }` |

## Local smoke test

Identity ids increment and are not reset by deleting rows, so always use the `id` returned by the
previous call instead of hard-coding `1`.

```bash
# 1. start the API
npm start

# 2. create a company and capture its id (node is already required by the project)
COMPANY_ID=$(curl -s -X POST http://localhost:3000/api/companies \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Corp","companyCode":"ACME001"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# 3. create a location for it (FK: companyId must exist and be valid)
LOCATION_ID=$(curl -s -X POST http://localhost:3000/api/companies-locations \
  -H 'Content-Type: application/json' \
  -d "{\"companyId\":$COMPANY_ID,\"locationName\":\"Head Office\",\"locationCode\":\"HO\"}" \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# 4. register a user (EMPLOYEE by default; location must belong to the company)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"jdoe\",\"password\":\"secret123\",\"companyId\":$COMPANY_ID,\"locationId\":$LOCATION_ID}"

# 5. list everything
curl -s http://localhost:3000/api/companies
curl -s http://localhost:3000/api/companies-locations
curl -s http://localhost:3000/api/roles
curl -s http://localhost:3000/api/users
curl -s http://localhost:3000/hello
```

Set `ADMIN_API_KEY` in `.env.local` (see `.env.local.example`) to exercise role creation:

```bash
curl -s -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Manager","roleCode":"MANAGER"}'
```

Schema, constraints and the ER diagram: [DATABASE_DESIGN.md](DATABASE_DESIGN.md).
Local setup commands: [LOCAL_SETUP.md](LOCAL_SETUP.md).

