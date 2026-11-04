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
| **Company user** (Owner / Manager / Employee with a company) | Bearer token carrying that `companyId` | **only its own company** | its role's hierarchy level + permissions |

A company user can never see or change another company's companies, locations, roles or users —
these requests are answered with `403 Forbidden`. Requests are also pinned automatically: when a
company user omits `companyId`, it is filled with its own company.

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

### Role hierarchy and permissions

`master_roles.hierarchy_level` orders authority — **lower number = more authority**:

| Role | Registered scope | `hierarchyLevel` | Permissions |
| --- | --- | ---: | --- |
| `ADMIN` | global (platform administrator) | `100` | `USER_CREATE`, `USER_VIEW`, `USER_UPDATE`, `USER_DELETE` |
| `OWNER` | company owner (role template is global, user carries `companyId`) | `200` | all four |
| `MANAGER` | company manager | `250` | all four |
| `EMPLOYEE`, `CLEANER`, `DRIVER`, `OFFICE_BOY`, `SECURITY_GUARD`, `RECEPTIONIST`, any custom role | employee level | `300` | none |
| custom company roles (e.g. `SUPERVISOR`) | owned by one company | chosen ≥ 250 | assigned explicitly |

Permissions are stored in `role_permissions` and are **checked separately** from hierarchy:
`GET /api/roles` returns each role's `permissions` array, and `PUT /api/roles/:id/permissions`
(platform administrator only) replaces it.

Authorization rules (enforced in `src/services/authorizationService.js`, not in controllers):

1. Authenticated **and** active user; role must be active (checked on every request from the DB).
2. Required **permission** must be granted to the actor's role (`USER_CREATE` / `USER_VIEW` / `USER_UPDATE`).
3. **Company** of the target must match the actor's (global actors are exempt).
4. **Hierarchy**: `actor.hierarchyLevel < targetRole.hierarchyLevel` (strictly lower authority).
5. Target role must be **active** and inside the actor's company scope.

Consequences:

- Admin (100) → Owner (200) / Manager (250) / Employee (300): allowed.
- Owner (200) → Manager (250) / Employee (300): allowed; Owner → Owner (200): denied.
- Manager (250) → Employee categories (300): allowed; Manager → Manager (250) or Owner (200): denied.
- Employee (300) → anything: denied (no permissions and no lower level).
- A company user can never read or write another company's users, even with a valid token.
- No one may manage **their own** account through `/api/users`.

## Endpoint summary

`Auth` column: **public** = no credentials, **any actor** = Bearer token or `x-admin-key`,
**admin** = actor holding the required `USER_*` permission, **platform** = platform administrator
(`ADMIN` / bootstrap, i.e. global actor with hierarchy ≤ 100).

| # | Method | Endpoint | Purpose | Auth | Company scoped |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET` | `/hello` | Liveness check (original endpoint) | public | – |
| 2 | `POST` | `/api/auth/login` | Exchange username/password for a token | public | – |
| 3 | `GET` | `/api/companies` | List companies | any actor | yes (company users see only their own) |
| 4 | `POST` | `/api/companies` | Create a company | platform | – |
| 5 | `PUT` | `/api/companies/:id` | Update a company | platform | – |
| 6 | `GET` | `/api/companies-locations` | List locations | any actor | yes |
| 7 | `POST` | `/api/companies-locations` | Create a location | any actor | yes (forced) |
| 8 | `PUT` | `/api/companies-locations/:id` | Update a location | any actor | yes |
| 9 | `GET` | `/api/roles` | List roles with permission codes | any actor | yes (global + own company) |
| 10 | `POST` | `/api/roles` | Create a role | platform | – (may target a company) |
| 11 | `PUT` | `/api/roles/:id` | Update a role | platform | – |
| 12 | `PUT` | `/api/roles/:id/permissions` | Replace a role's permission set | platform | – |
| 13 | `GET` | `/api/users` | List users | `USER_VIEW` | yes (subordinates only for company users) |
| 14 | `POST` | `/api/users` | Create a user | `USER_CREATE` | yes (forced; subordinate role) |
| 15 | `PUT` | `/api/users/:id` | Update a user | `USER_UPDATE` | yes (own company, lower authority) |

**User creation matrix** (validated server-side; company ids and hierarchy from the request are ignored):

| Actor | Can create | Company stored | `created_by_user_id` |
| --- | --- | --- | --- |
| Administrator (100) | `OWNER`, `MANAGER`, employee roles — any company | as requested (or `NULL`) | actor's user id |
| Owner (200) | `MANAGER` (250), employee roles (300) | actor's company | owner's user id |
| Manager (250) | employee roles (300) | actor's company | manager's user id |
| Employee (300) | nothing (`403`) | – | – |

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

- **Global templates** (`company_id = null`): `ADMIN` (100), `OWNER` (200), `MANAGER` (250),
  `EMPLOYEE`/`CLEANER`/`DRIVER`/`OFFICE_BOY`/`SECURITY_GUARD`/`RECEPTIONIST` (300).
- **Company roles** (`company_id = <company>`): e.g. a `SUPERVISOR` owned by one company. A code may
  exist in several companies because uniqueness is `(company_id, role_code)`.
- Each role carries its **permission codes** (`role_permissions`): `ADMIN`, `OWNER` and `MANAGER` hold
  all four `USER_*` permissions; employee-level roles hold none.

**Who can do what**

| Operation | Platform administrator (`ADMIN` / `x-admin-key`) | Company users (Owner/Manager/…) |
| --- | --- | --- |
| `GET /api/roles` | every role | global roles + own company roles, read-only |
| `POST /api/roles` | global role or role for any company | `403` |
| `PUT /api/roles/:id` | any role | `403` |
| `PUT /api/roles/:id/permissions` | any role | `403` |

Roles are catalogued centrally so a company user can never mint authority for itself. Assigning a
role to a user is still governed by the hierarchy rules (section “Role hierarchy and permissions”).

### 5.1 `GET /api/roles`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `includeInvalid` | boolean | `false` | Include rows with `is_valid = false` |

```bash
curl http://localhost:3000/api/roles -H "Authorization: Bearer $TOKEN"
```

**Response — `200 OK`** (company user of company 3)

```json
{
  "count": 4,
  "data": [
    { "id": 1, "role_name": "Administrator", "role_code": "ADMIN", "company_id": null, "hierarchy_level": 100, "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z", "permissions": ["USER_CREATE","USER_DELETE","USER_UPDATE","USER_VIEW"] },
    { "id": 79, "role_name": "Owner", "role_code": "OWNER", "company_id": null, "hierarchy_level": 200, "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z", "permissions": ["USER_CREATE","USER_DELETE","USER_UPDATE","USER_VIEW"] },
    { "id": 12, "role_name": "Supervisor", "role_code": "SUPERVISOR", "company_id": 3, "hierarchy_level": 250, "is_valid": true, "dt_entry_date": "2026-11-03T13:35:12.789Z", "permissions": [] },
    { "id": 2, "role_name": "Employee", "role_code": "EMPLOYEE", "company_id": null, "hierarchy_level": 300, "is_valid": true, "dt_entry_date": "2026-11-03T13:30:00.000Z", "permissions": [] }
  ]
}
```

Roles are ordered by `hierarchy_level` (higher authority first) and never include another
company's roles.

### 5.2 `POST /api/roles` — platform administrator only

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | ✅ | must not be blank |
| `roleCode` | string (≤50) | ✅ | uppercase; **unique per company** (`uq_master_roles_company_code`) |
| `companyId` | integer / null | No | `null` = global template, otherwise the owning company |
| `hierarchyLevel` | integer > 0 | No | default `300`; use 250 for manager-equivalent roles |

```bash
# platform administrator creating a company-specific supervisor role
curl -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Supervisor","roleCode":"SUPERVISOR","companyId":34,"hierarchyLevel":250}'
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
`403` not the platform administrator · `409` duplicate code in that company.

### 5.3 `PUT /api/roles/:id` — platform administrator only

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `roleName` | string (≤100) | No | must not be blank |
| `roleCode` | string (≤50) | No | unique per company |
| `hierarchyLevel` | integer > 0 | No | ordering authority (e.g. 250 for supervisor/manager level) |
| `isValid` | boolean | No | deactivating revokes access for users holding the role |
| `companyId` | – | ❌ | rejected with `400` — a role cannot move between companies |

```bash
curl -X PUT http://localhost:3000/api/roles/12 \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleName":"Shift Supervisor","hierarchyLevel":260}'
```

**Response — `200 OK`** — `{ "data": { ...role... } }`

Errors: `401` not authenticated · `403` not the platform administrator · `400` no updatable field ·
`404` role not found · `409` duplicate `roleCode`.

### 5.4 `PUT /api/roles/:id/permissions` — platform administrator only

Replaces the role's permission set (codes not listed are deactivated).

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `permissions` | string[] | ✅ | array of `USER_CREATE` / `USER_VIEW` / `USER_UPDATE` / `USER_DELETE` (uppercase, extensible) |

```bash
curl -X PUT http://localhost:3000/api/roles/12/permissions \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"permissions":["USER_VIEW","USER_CREATE"]}'
```

**Response — `200 OK`**

```json
{ "data": { "roleId": 12, "roleCode": "SUPERVISOR", "permissions": ["USER_CREATE", "USER_VIEW"] } }
```

Errors: `400` unknown permission format · `401` not authenticated · `403` not the platform
administrator · `404` role not found.

> Renaming/deactivating `ADMIN` or `EMPLOYEE` is allowed but discouraged: seeding only inserts missing
> codes, and `userModel.register()` depends on `EMPLOYEE` existing.


## 6. Users

A user row references four relationships: `role_id` (required), `company_id` (optional),
`location_id` (optional, only valid together with its company) and `created_by_user_id` (who created
the account — set by the server from the authenticated actor). Passwords are hashed with bcrypt; the
hash is never returned.

A user's **company** defines its tenancy: a company user only ever sees that company's data. Users
without a company are global. Authorization combines **permission** (`role_permissions`) and
**hierarchy** (`actor.hierarchyLevel < targetRole.hierarchyLevel`).

**Who can do what**

| Operation | Administrator (100) | Owner (200) | Manager (250) | Employee (300) |
| --- | --- | --- | --- | --- |
| `GET /api/users` | all users, all companies | own company, subordinates only | own company, subordinates only | `403` (no `USER_VIEW`) |
| `POST /api/users` | any role, any company | `MANAGER`, employee roles, own company | employee roles, own company | `403` (no `USER_CREATE`) |
| `PUT /api/users/:id` | any user | own company, lower authority | own company, lower authority | `403` (no `USER_UPDATE`) |
| manage own account | – | – | – | – |

Additional guarantees: a user can never be moved to another company by a company user, can never be
given a role at or above the actor's authority, and cannot modify itself through this API.

### 6.1 `GET /api/users`

| Query parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `companyId` | integer | – | Only users of this company (company users: own company, others `403`) |
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
      "id": 21,
      "username": "cleaner1",
      "role_id": 84,
      "role_code": "CLEANER",
      "hierarchy_level": 300,
      "company_id": 34,
      "location_id": 26,
      "created_by_user_id": 40,
      "is_valid": true,
      "dt_entry_date": "2026-11-04T13:40:00.000Z"
    }
  ]
}
```

`role_code`/`hierarchy_level` come from a join with `master_roles`, `created_by_user_id` shows who
created the account, and no `password` field is ever selected. Company users only receive their
subordinates (strictly lower authority), never peers or superiors.

### 6.2 `POST /api/users` — requires `USER_CREATE`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | ✅ | **unique**, case-insensitive |
| `password` | string (8–72) | ✅ | stored as bcrypt hash, never returned |
| `roleCode` | string | No | default `EMPLOYEE`; resolved in the target company scope (**FK** → `master_roles`) |
| `companyId` | integer / null | No | **FK** → `master_companies.id`; company actors: forced to own company |
| `locationId` | integer / null | No | **FK** → `companies_locations.id`; must belong to `companyId` and be `is_valid`; requires `companyId` |

Server-side validation order: `USER_CREATE` permission → company scope → role active/in scope →
`actor.hierarchyLevel < role.hierarchyLevel` → insert (with `created_by_user_id = actor.userId`) in one
transaction. Any `hierarchyLevel` sent by the client is ignored.

```bash
# platform administrator creating a company Owner
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"username":"owner_acme","password":"secret123","roleCode":"OWNER","companyId":34}'

# Owner creating a Manager (company comes from the token)
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"username":"manager1","password":"secret123","roleCode":"MANAGER"}'

# Manager creating a Cleaner / Driver (employee level)
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"username":"cleaner1","password":"secret123","roleCode":"CLEANER"}'

curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"username":"driver1","password":"secret123","roleCode":"DRIVER"}'
```

**Response — `201 Created`**

```json
{
  "data": {
    "id": 21,
    "username": "cleaner1",
    "role_id": 84,
    "company_id": 34,
    "location_id": null,
    "created_by_user_id": 41,
    "is_valid": true,
    "dt_entry_date": "2026-11-04T13:40:00.000Z"
  }
}
```

Errors: `400` validation / unknown role in scope / unknown company / location not in company /
`locationId` without `companyId` · `401` not authenticated · `403` missing `USER_CREATE`, other
company, inactive actor/role, or a role at/above the actor's authority · `409` username already taken.

### 6.3 `PUT /api/users/:id` — requires `USER_UPDATE`

| Body field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `username` | string (3–100) | No | unique (case-insensitive) |
| `password` | string (8–72) | No | re-hashed with bcrypt |
| `roleCode` | string | No | existing active role in the target company scope, subordinate to the actor |
| `companyId` | integer / null | No | global actors only; company users receive `403` |
| `locationId` | integer / null | No | must belong to the effective company (after this update) |
| `isValid` | boolean | No | deactivate / reactivate |

Target restrictions: the target must be in the actor's company and have a **strictly lower** authority;
the actor cannot target itself. A Manager cannot touch an Owner, a peer Manager or an Administrator.

```bash
# Manager deactivating a cleaner of its company
curl -X PUT http://localhost:3000/api/users/21 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"isValid":false}'

# Administrator promoting a user across companies
curl -X PUT http://localhost:3000/api/users/21 \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"roleCode":"MANAGER","companyId":34}'
```

**Response — `200 OK`** — `{ "data": { ...user... } }`

Errors: `400` no updatable field / `locationId` without company / location not in the company /
unknown role or company · `401` not authenticated · `403` missing `USER_UPDATE`, other company, equal or
higher authority, self-management, or a role change above the actor · `404` user not found ·
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
| `created_by_user_id` (users) | `fk_users_created_by` | `users.id` | model (creator pre-check) + DB | `400 Creating user {id} does not exist.` |
| `role_id` (role_permissions) | `fk_role_permissions_role` | `master_roles.id` | model (`role` lookup) + DB | `404 Role {id} was not found.` |

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
previous call instead of hard-coding values. `ADMIN_API_KEY` and `JWT_SECRET` come from `.env.local`
(see `.env.local.example`). For the automated version of these scenarios run `npm test`.

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

# 3. platform administrator creates the company Owner (hierarchy 200)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d "{\"username\":\"owner_acme\",\"password\":\"secret123\",\"roleCode\":\"OWNER\",\"companyId\":$COMPANY_ID}"

# 4. log in as the Owner
OWNER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner_acme","password":"secret123"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.token')

# 5. Owner creates a Manager (250) — company + created_by are filled server-side
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"username":"manager_acme","password":"secret123","roleCode":"MANAGER"}'

# 6. Manager logs in and creates employee-level users (300)
MANAGER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"manager_acme","password":"secret123"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.token')

curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"username":"cleaner_acme","password":"secret123","roleCode":"CLEANER"}'

# 7. denied by hierarchy / permission (expect 403)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"username":"manager2_acme","password":"secret123","roleCode":"MANAGER"}'

# 8. scoped reads: Owner sees only its company's subordinates
curl -s http://localhost:3000/api/users -H "Authorization: Bearer $OWNER_TOKEN"
curl -s http://localhost:3000/api/roles -H "Authorization: Bearer $OWNER_TOKEN"

# 9. public liveness endpoint
curl -s http://localhost:3000/hello
```

Expected: step 7 answers `403` (a Manager cannot create a Manager), the Owner's `GET /api/users`
returns only that company's Managers/Employees, and `GET /api/roles` includes each role's
`permissions` array.

Schema, constraints and the ER diagram: [DATABASE_DESIGN.md](DATABASE_DESIGN.md).
Local setup commands: [LOCAL_SETUP.md](LOCAL_SETUP.md).

