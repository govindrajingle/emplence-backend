# REST Endpoints

Complete HTTP API reference for the Emplence backend. Base URL for local development:

```text
http://localhost:3000
```

On a phone/another device on the same Wi-Fi use the LAN address printed at startup
(for example `http://192.168.1.22:3000`) — see [LOCAL_SETUP.md §16](LOCAL_SETUP.md#16-access-hello-from-an-android-phone-on-the-same-wi-fi).

- [Conventions](#conventions)
- [Authentication and company tenancy](#authentication-and-company-tenancy)
- [Endpoint summary](#endpoint-summary)
- [1. GET /hello](#1-get-hello)
- [2. POST /api/auth/login](#2-post-apiauthlogin)
- [3. Companies](#3-companies)
- [4. Companies locations](#4-companies-locations)
- [5. Roles](#5-roles)
- [6. Users](#6-users)
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
- **Authentication:** every `/api/*` route except `POST /api/auth/login` requires either a
  `Authorization: Bearer <token>` header or the bootstrap `x-admin-key` header. `/hello` stays public.
- **Request id:** every response carries an `x-request-id` header that also appears in the server logs
  (`req=…`) together with the endpoint name, status code and duration.

## Authentication and company tenancy

### Two kinds of caller

| Caller | Credential | Scope | Authority |
| --- | --- | --- | --- |
| Platform administrator (bootstrap) | `x-admin-key: $ADMIN_API_KEY` | all companies | highest (hierarchy 0) |
| Global admin user (created with no company) | Bearer token, `companyId: null` | all companies | hierarchy of its role (`ADMIN` = 1) |
| **Company sub-admin** (created with a company) | Bearer token carrying that `companyId` | **only its own company** | its role's hierarchy level |

A company sub-admin can never see or change another company's companies, locations, roles or users —
these requests are answered with `403 Forbidden`. Requests are also pinned automatically: when a
sub-admin omits `companyId`, it is filled with its own company.

### `POST /api/auth/login`

Public endpoint. Verifies the bcrypt password hash and returns a JWT.

| Body field | Type | Required |
| --- | --- | --- |
| `username` | string (3–100, case-insensitive lookup) | ✅ |
| `password` | string | ✅ |

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"subadmin_acme","password":"secret123"}'
```

**Response — `200 OK`**

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "tokenType": "Bearer",
    "expiresInSeconds": 28800,
    "user": {
      "id": 7,
      "username": "subadmin_acme",
      "roleCode": "ADMIN",
      "roleScope": "company",
      "hierarchyLevel": 1,
      "companyId": 3,
      "companyName": "Acme Corp"
    }
  }
}
```

Errors: `400` missing field · `401` unknown username / wrong password / inactive user ·
`403` the account's company is deactivated · `503` `JWT_SECRET` not configured.

The token contains `sub` (user id), `roleCode`, `companyId` and `hierarchyLevel`; it is signed with
`JWT_SECRET` and expires after `AUTH_TOKEN_TTL_SECONDS` (default 28800 = 8 h).

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"subadmin_acme","password":"secret123"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.token')

curl -s http://localhost:3000/api/users -H "Authorization: Bearer $TOKEN"
```

### Creating a company sub-admin (platform administrator)

```bash
# x-admin-key = ADMIN_API_KEY from your .env file
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"username":"subadmin_acme","password":"secret123","roleCode":"ADMIN","companyId":3}'
```

The resulting user has `role_code = ADMIN` **and** `company_id = 3`, which is what makes it a
sub-admin: on login the token is scoped to company 3.

### Role hierarchy

`master_roles.hierarchy_level` orders authority — **lower number = more authority**:

| Role | Scope | `hierarchyLevel` |
| --- | --- | --- |
| `ADMIN` | global (seeded) | `1` |
| company roles created by a sub-admin (e.g. `SUPERVISOR`) | company | e.g. `50` |
| `EMPLOYEE` | global (seeded) | `100` |

Rules enforced by the API:

- A sub-admin can only create/update roles **of its own company** and only with
  `hierarchyLevel` **greater than its own** (it cannot create a peer or a superior).
- A sub-admin can only assign roles whose `hierarchyLevel` is greater than its own, so it can never
  create another `ADMIN` (or a role above itself).
- A sub-admin cannot modify a user whose authority is equal to or higher than its own.
- Global actors (`x-admin-key`, global admin) are not restricted by hierarchy.

## Endpoint summary

`Auth` column: **public** = no credentials, **any actor** = Bearer token or `x-admin-key`,
**admin** = `ADMIN` role actor (global admin or company sub-admin), **platform** = bootstrap key or
company-less admin only.

| # | Method | Endpoint | Purpose | Auth | Company scoped |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET` | `/hello` | Liveness check (original endpoint) | public | – |
| 2 | `POST` | `/api/auth/login` | Exchange username/password for a token | public | – |
| 3 | `GET` | `/api/companies` | List companies | any actor | yes (sub-admin sees only its own) |
| 4 | `POST` | `/api/companies` | Create a company | platform | – |
| 5 | `PUT` | `/api/companies/:id` | Update a company | platform | – |
| 6 | `GET` | `/api/companies-locations` | List locations | any actor | yes |
| 7 | `POST` | `/api/companies-locations` | Create a location | any actor | yes (forced) |
| 8 | `PUT` | `/api/companies-locations/:id` | Update a location | any actor | yes |
| 9 | `GET` | `/api/roles` | List roles | any actor | yes (global + own company) |
| 10 | `POST` | `/api/roles` | Create a role | admin | yes (forced; subordinate level) |
| 11 | `PUT` | `/api/roles/:id` | Update a role | admin | yes (own company roles only) |
| 12 | `GET` | `/api/users` | List users | any actor | yes |
| 13 | `POST` | `/api/users` | Create a user | admin | yes (forced; subordinate role) |
| 14 | `PUT` | `/api/users/:id` | Update a user | admin | yes (own company, lower authority) |

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

## 2. POST /api/auth/login

Documented in detail in [Authentication and company tenancy](#authentication-and-company-tenancy):
`{ "username": "...", "password": "..." }` → `200` with a Bearer token scoped to the user's company.
This is the entry point for **company sub-admins**: the token carries their `companyId`, which pins
every later request to that company.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"subadmin_acme","password":"secret123"}'
```

## 3. Companies

Company master records are created/maintained by the **platform administrator** only.
A company sub-admin may call `GET /api/companies`, but only ever sees its own company.

### 3.1 `GET /api/companies`

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

### 3.2 `POST /api/companies`

**Auth:** platform administrator (`x-admin-key` or a company-less admin token).

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `companyName` | string (≤255) | ✅ | must not be blank |
| `companyCode` | string (≤50) | ✅ | **unique** (`uq_master_companies_company_code`) |

```bash
curl -X POST http://localhost:3000/api/companies \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
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

### 3.3 `PUT /api/companies/:id`

**Auth:** platform administrator only (a sub-admin receives `403`).

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `companyName` | string (≤255) | No | must not be blank |
| `companyCode` | string (≤50) | No | unique |
| `isValid` | boolean | No | soft delete / reactivate |

```bash
curl -X PUT http://localhost:3000/api/companies/1 \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"companyName":"Acme Corporation","isValid":true}'
```

**Response — `200 OK`** — `{ "data": { ...updated company... } }`

Errors: `400` no updatable field / invalid value · `404` company not found ·
`409` duplicate `companyCode`.

> Deactivating a company (`isValid: false`) does **not** cascade: its locations and users keep
> their rows. New locations/users can no longer reference it because the model layer checks
> `is_valid = TRUE`.


## 4. Companies locations

A location always belongs to exactly one company (`companies_locations.company_id` →
`master_companies.id`). `location_code` is unique **per company**, so `HO` may exist for two
different companies but not twice for the same one.

### 4.1 `GET /api/companies-locations`

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

### 4.2 `POST /api/companies-locations`

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

### 4.3 `PUT /api/companies-locations/:id`

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


## 5. Roles

Roles are the backbone of company tenancy:

- **Global roles** (`company_id = null`, seeded): `ADMIN` (hierarchy `1`) and `EMPLOYEE` (`100`).
- **Company roles** (`company_id = <company>`): created by that company's sub-admin, e.g.
  `SUPERVISOR` (`50`), `WORKER` (`100`). A code may exist in several companies because uniqueness is
  `(company_id, role_code)`.

**Who can do what**

| Operation | Global actor (`x-admin-key` / company-less admin) | Company sub-admin |
| --- | --- | --- |
| `GET /api/roles` | every role | global roles + own company roles |
| `POST /api/roles` | global role or any company role | own company only, `hierarchyLevel` **>** own |
| `PUT /api/roles/:id` | any role | own company roles only, level stays **>** own |

`MASTER`/`ADMIN`-style elevation is impossible for sub-admins: `ADMIN` sits at level `1`, so it is
never greater than a sub-admin's own level. Role writes require the `ADMIN` role; unauthenticated
requests get `401`, non-admin roles get `403`.

### 5.1 `GET /api/roles`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `includeInvalid` | boolean | `false` | Include rows with `is_valid = false` |

```bash
curl http://localhost:3000/api/roles -H "Authorization: Bearer $TOKEN"
```

**Response — `200 OK`** (company sub-admin of Acme)

```json
{
  "count": 4,
  "data": [
    { "id": 1, "role_name": "Administrator", "role_code": "ADMIN", "company_id": null, "hierarchy_level": 1, "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z" },
    { "id": 12, "role_name": "Supervisor", "role_code": "SUPERVISOR", "company_id": 3, "hierarchy_level": 50, "is_valid": true, "dt_entry_date": "2026-11-03T13:35:12.789Z" },
    { "id": 13, "role_name": "Worker", "role_code": "WORKER", "company_id": 3, "hierarchy_level": 100, "is_valid": true, "dt_entry_date": "2026-11-03T13:35:20.101Z" },
    { "id": 2, "role_name": "Employee", "role_code": "EMPLOYEE", "company_id": null, "hierarchy_level": 100, "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z" }
  ]
}
```

Roles are ordered by `hierarchy_level` (higher authority first) and never include another
company's roles.

### 5.2 `POST /api/roles` — requires the `ADMIN` role

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | ✅ | must not be blank |
| `roleCode` | string (≤50) | ✅ | uppercase; **unique per company** (`uq_master_roles_company_code`) |
| `companyId` | integer / null | No | `null` = global role (global actors only). Sub-admins: forced to own company |
| `hierarchyLevel` | integer > 0 | No | default `100`; must be **greater than the caller's** level for sub-admins |

```bash
# company sub-admin creating a subordinate role (company comes from the token)
curl -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"roleName":"Supervisor","roleCode":"SUPERVISOR","hierarchyLevel":50}'

# platform administrator creating a global role
curl -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Auditor","roleCode":"AUDITOR","hierarchyLevel":5}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 12,
    "role_name": "Supervisor",
    "role_code": "SUPERVISOR",
    "company_id": 3,
    "hierarchy_level": 50,
    "is_valid": true,
    "dt_entry_date": "2026-11-03T13:35:12.789Z"
  }
}
```

Errors: `400` missing/blank value, unknown company, invalid `hierarchyLevel` · `401` not authenticated ·
`403` not an `ADMIN`, other company, or a level that is not subordinate · `409` duplicate code in that
company.

### 5.3 `PUT /api/roles/:id` — requires the `ADMIN` role

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | No | must not be blank |
| `roleCode` | string (≤50) | No | unique per company |
| `hierarchyLevel` | integer > 0 | No | sub-admins: must stay greater than their own level |
| `isValid` | boolean | No | soft delete (users keep the role reference) |
| `companyId` | – | ❌ | rejected with `400` — a role cannot move between companies |

```bash
curl -X PUT http://localhost:3000/api/roles/12 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"roleName":"Shift Supervisor","hierarchyLevel":40}'
```

**Response — `200 OK`** — `{ "data": { ...role... } }`

Errors: `401` invalid admin key · `503` disabled · `400` no updatable field ·
`404` role not found · `409` duplicate `roleCode`.

> Renaming/soft-deleting `ADMIN` or `EMPLOYEE` is allowed but discouraged: the seeding logic only
> inserts missing codes, and `userModel.register()` depends on `EMPLOYEE` existing.


## 6. Users

A user row references three tables: `role_id` (required), `company_id` (optional) and `location_id`
(optional, and only valid together with a company that owns that location). Passwords are hashed with
bcrypt before insert; the hash is never returned by any endpoint.

A user's **company** defines its tenancy: a user with `company_id` set is a company sub-admin/employee
and, when logged in, only sees that company's data. Users without a company are global.

**Who can do what**

| Operation | Global actor | Company sub-admin |
| --- | --- | --- |
| `GET /api/users` | all users, optional filters | own company only (`403` if it asks for another) |
| `POST /api/users` | any company, any role | own company only; role must be subordinate |
| `PUT /api/users/:id` | any user | own company users, lower authority only |

### 6.1 `GET /api/users`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `companyId` | integer | – | Only users of this company (sub-admins: own company, others `403`) |
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

### 6.2 `POST /api/users` — requires the `ADMIN` role

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | ✅ | **unique**, case-insensitive |
| `password` | string (8–72) | ✅ | stored as bcrypt hash, never returned |
| `roleCode` | string | No | default `EMPLOYEE`; resolved in the target company scope (**FK** → `master_roles`) |
| `companyId` | integer / null | No | **FK** → `master_companies.id`; sub-admins: forced to own company |
| `locationId` | integer / null | No | **FK** → `companies_locations.id`; must belong to `companyId` and be `is_valid`; requires `companyId` |

Role resolution: the company's own role with that code wins over the global one. A sub-admin can only
assign roles whose `hierarchyLevel` is greater than its own, so `ADMIN` (level `1`) is refused with
`403`.

```bash
# platform administrator creating a company sub-admin
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"username":"subadmin_acme","password":"secret123","roleCode":"ADMIN","companyId":3}'

# company sub-admin creating a subordinate user (company comes from the token)
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"supervisor1","password":"secret123","roleCode":"SUPERVISOR"}'

# company sub-admin creating a worker at a location of its company
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"worker1","password":"secret123","roleCode":"WORKER","locationId":11}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 21,
    "username": "worker1",
    "role_id": 13,
    "company_id": 3,
    "location_id": 11,
    "is_valid": true,
    "dt_entry_date": "2026-11-03T13:40:00.000Z"
  }
}
```

Errors: `400` validation / unknown role in scope / unknown company / location not in company /
`locationId` without `companyId` · `401` not authenticated · `403` not `ADMIN`, other company, or a role
that is not subordinate to the caller · `409` username already taken (case-insensitive).

### 6.3 `PUT /api/users/:id` — requires the `ADMIN` role

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | No | unique (case-insensitive) |
| `password` | string (8–72) | No | re-hashed with bcrypt |
| `roleCode` | string | No | existing role in the target company scope, must be subordinate to the caller |
| `companyId` | integer / null | No | global actors only; sub-admins receive `403` |
| `locationId` | integer / null | No | must belong to the effective company (after this update) |
| `isValid` | boolean | No | soft delete / reactivate |

Target user restrictions for sub-admins: the user must belong to their company and have a strictly
lower authority (so a sub-admin cannot edit itself or a peer `ADMIN`).

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
| `roleCode` (users) | `fk_users_role` | `master_roles` (code resolved within company scope) | model lookup + DB FK | `400 Role "{code}" does not exist for this company scope.` |
| `companyId` (roles) | `fk_master_roles_company` | `master_companies.id` | model (pre-check within transaction) + DB | `400 Company {id} does not exist or is not valid.` |
| `companyId` (locations, update) | – | – | model rule | `400 companyId cannot be changed; create a new location for the other company instead.` |
| `companyId` (roles, update) | – | – | model rule | `400 companyId cannot be changed on an existing role.` |

Database-level guarantees that back these up:

- `users.location_id` is nullable, but `chk_users_location_requires_company` rejects a location
  without a company.
- `master_roles.company_id` is nullable: `NULL` = global role, otherwise the owning company.
  `chk_master_roles_hierarchy_level` rejects levels ≤ 0.
- All foreign keys use `ON UPDATE CASCADE ON DELETE RESTRICT`: a company/role/location that is still
  referenced cannot be deleted.
- Unique constraints: `master_companies.company_code`,
  `master_roles (company_id, role_code)` with `NULLS NOT DISTINCT` (so global codes stay unique),
  `users.username` (+ `lower(username)`), `companies_locations (company_id, location_code)`.

Practical implications when building clients:

1. Create the company before its locations; create locations before assigning users to them.
2. Read ids from create responses (or `GET` lists) and send them as numbers.
3. Deactivation is `isValid: false`; assignments referencing inactive rows are refused by the model
   layer even though the row still exists.
4. Log in as the company sub-admin and send `Authorization: Bearer <token>`; the company scope and
   hierarchy are taken from the token, never from the request body.
5. Cross-company access is rejected with `403`, not silently ignored.

## Status codes and errors

| Status | Meaning in this API | Example body |
| --- | --- | --- |
| `200` | Read/update succeeded | `{ "data": { ... } }` |
| `201` | Record created | `{ "data": { ... } }` |
| `400` | Validation, foreign-key or relationship violation | `{ "message": "locationId requires companyId." }` |
| `401` | Missing/invalid Bearer token or `x-admin-key`, wrong login credentials | `{ "message": "Invalid session token." }` |
| `403` | Authenticated but not allowed (other company, role not subordinate, not `ADMIN`) | `{ "message": "You can only access users of your own company." }` |
| `404` | Unknown id or route | `{ "message": "User 42 was not found." }` |
| `409` | Unique constraint violation | `{ "message": "Username \"jdoe\" is already taken." }` |
| `500` | Unexpected error (details only in server logs) | `{ "message": "Internal server error." }` |
| `503` | Login or admin-key features not configured | `{ "message": "Authentication is not configured. Set JWT_SECRET in the environment to enable login." }` |

## Local smoke test

Identity ids increment and are not reset by deleting rows, so always use the `id` returned by the
previous call instead of hard-coding `1`. `ADMIN_API_KEY` and `JWT_SECRET` come from `.env.local`
(see `.env.local.example`).

```bash
# 1. start the API
npm start
export ADMIN_API_KEY=local-dev-admin-key   # value from .env.local

# 2. create a company (platform administrator) and capture its id
COMPANY_ID=$(curl -s -X POST http://localhost:3000/api/companies \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"companyName":"Acme Corp","companyCode":"ACME001"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# 3. create a location for it (FK: companyId must exist and be valid)
LOCATION_ID=$(curl -s -X POST http://localhost:3000/api/companies-locations \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d "{\"companyId\":$COMPANY_ID,\"locationName\":\"Head Office\",\"locationCode\":\"HO\"}" \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# 4. create the company sub-admin (ADMIN role + company = scoped account)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d "{\"username\":\"subadmin_acme\",\"password\":\"secret123\",\"roleCode\":\"ADMIN\",\"companyId\":$COMPANY_ID,\"locationId\":$LOCATION_ID}"

# 5. log in as the sub-admin
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"subadmin_acme","password":"secret123"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.token')

# 6. the token only ever sees this company
curl -s http://localhost:3000/api/companies -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/users -H "Authorization: Bearer $TOKEN"

# 7. create subordinate roles for the company (SUPERVISOR -> WORKER)
curl -s -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"roleName":"Supervisor","roleCode":"SUPERVISOR","hierarchyLevel":50}'

curl -s -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"roleName":"Worker","roleCode":"WORKER","hierarchyLevel":100}'

# 8. create users with those roles (company is taken from the token)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"supervisor1","password":"secret123","roleCode":"SUPERVISOR"}'

# 9. public liveness endpoint
curl -s http://localhost:3000/hello
```

Expected: the sub-admin's `GET /api/companies` returns exactly one company, `GET /api/users` only users
of that company, and requesting another company's data answers `403`.

Schema, constraints and the ER diagram: [DATABASE_DESIGN.md](DATABASE_DESIGN.md).
Local setup commands: [LOCAL_SETUP.md](LOCAL_SETUP.md).

