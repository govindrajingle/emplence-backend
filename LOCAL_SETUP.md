# Local Setup Commands — Docker PostgreSQL 18 → Running API

Every command needed to go from a fresh checkout to a running backend on your machine,
using the bundled Docker database. Run them from the project root (`emplence-backend/`).

Shell: macOS/Linux (`zsh`/`bash`).

## 0. Quick path (copy-paste)

```bash
npm install
npm run db:up
cp .env.local.example .env.local
npm run db:migrate
npm start
# in a second terminal:
curl http://localhost:3000/hello
```

Details for each step, plus verification, cleanup and troubleshooting, are below.

## 1. Verify prerequisites

```bash
node --version          # must be v18+ (verified on v24.20.0)
npm --version           # 11.19.0
docker --version        # Docker version 29.9.2
docker compose version  # Docker Compose version v5.6.1
```

Docker Desktop must be **running** before any `docker compose` command:

```bash
open -a Docker                                  # start Docker Desktop (macOS)
docker info --format '{{.ServerVersion}}'       # prints a version when the daemon is ready
```

If you see `failed to connect to the docker API ... docker.sock`, the daemon is not up yet —
wait for Docker Desktop to finish starting and re-run `docker info`.

## 2. Install dependencies

```bash
cd /path/to/emplence-backend
npm install
```

Installs the only runtime dependencies: `express`, `pg`, `dotenv`.

## 3. Start PostgreSQL 18 in Docker

```bash
npm run db:up
# identical to:
docker compose up -d
```

What this creates:

| Item            | Value                              |
| --------------- | ---------------------------------- |
| Image           | `postgres:18`                      |
| Container name  | `emplence-postgres18`              |
| Database        | `default`                          |
| User / password | `emplence` / `emplence`            |
| Host port       | `5433` (maps to container `5432`) |
| Data volume     | `postgres18-data`                  |
| TLS             | none (plain connections)           |

First run also pulls the image and runs `initdb`, so it can take 10–40 seconds.

## 4. Confirm the database is healthy

```bash
docker compose ps
docker inspect -f '{{.State.Health.Status}}' emplence-postgres18    # -> healthy
docker exec emplence-postgres18 pg_isready -U emplence -d default   # -> accepting connections
```

Follow the container logs if something looks wrong:

```bash
docker compose logs -f postgres     # Ctrl+C stops following; the container keeps running
```

## 5. Create the local environment file

```bash
cp .env.local.example .env.local
```

`.env.local` is git-ignored and **overrides** `.env` (`.env.local` is read first).

Contents of `.env.local`:

| Variable                | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| `PORT`                  | `3000`                                                 |
| `NODE_ENV`              | `development`                                          |
| `DATABASE_URL`          | `postgresql://emplence:emplence@localhost:5433/default` |
| `DB_SSL_MODE`           | `disable` (the Docker image serves no TLS)             |
| `DB_CONNECT_TIMEOUT_MS` | `10000`                                                |

Verify the file and that Git ignores it:

```bash
cat .env.local
git check-ignore -v .env.local      # -> .gitignore:6:.env.*   .env.local
```

## 6. Start the API

```bash
npm start        # node src/server.js
# or, with auto-reload on file changes:
npm run dev      # node --watch src/server.js
```

Expected output:

```text
[env] loaded .env.local, .env
[db] connected to "default" - PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) ...
[db] ssl: disabled (DB_SSL_MODE=disable)
[server] listening on http://localhost:3000
```

> `.env` appears in the `[env] loaded ...` line only when that file exists. With just `.env.local`
> present, the line reads `[env] loaded .env.local` — which is enough for local development.

Stop the API with `Ctrl+C` — it shuts down gracefully
(`[server] SIGINT received, shutting down gracefully...`).

## 7. Verify the endpoint

```bash
curl http://localhost:3000/hello
# {"message":"Hello! Backend is running successfully."}

curl -i http://localhost:3000/hello     # includes headers: HTTP/1.1 200 OK
curl http://localhost:3000/does-not-exist   # 404 JSON: {"message":"Route GET /does-not-exist not found."}
```

Or open <http://localhost:3000/hello> in a browser.

## 7b. REST endpoints overview

Full payloads, examples and foreign-key rules: [RESTEndpoints.md](RESTEndpoints.md).
Ids increment per insert, so use the `id` returned by each create call rather than hard-coding `1`.

```bash
curl -s http://localhost:3000/api/companies
curl -s http://localhost:3000/api/companies-locations?companyId=1
curl -s http://localhost:3000/api/roles
curl -s http://localhost:3000/api/users

# create a company and capture its id
COMPANY_ID=$(curl -s -X POST http://localhost:3000/api/companies \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Corp","companyCode":"ACME001"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# create a location for that company (FK: companyId)
LOCATION_ID=$(curl -s -X POST http://localhost:3000/api/companies-locations \
  -H 'Content-Type: application/json' \
  -d "{\"companyId\":$COMPANY_ID,\"locationName\":\"Head Office\",\"locationCode\":\"HO\"}" \
  | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).data.id')

# register a user (EMPLOYEE by default; location must belong to the company)
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"jdoe\",\"password\":\"secret123\",\"companyId\":$COMPANY_ID,\"locationId\":$LOCATION_ID}"

# role management requires the admin key from .env.local (ADMIN_API_KEY)
curl -s -X POST http://localhost:3000/api/roles \
  -H 'Content-Type: application/json' \
  -H 'x-admin-key: local-dev-admin-key' \
  -d '{"roleName":"Manager","roleCode":"MANAGER"}'
```

Without `x-admin-key`, `POST/PUT /api/roles` answers `401` (or `503` when `ADMIN_API_KEY` is unset),
and assigning a non-`EMPLOYEE` role to a user is rejected the same way.

## 8. Inspect the database

```bash
# interactive psql shell
docker exec -it emplence-postgres18 psql -U emplence -d default
#   select version();
#   select current_database();
#   \l      -- list databases
#   \q      -- quit

# one-off queries without a shell
docker exec emplence-postgres18 psql -U emplence -d default -tAc 'select version();'
docker exec emplence-postgres18 psql -U emplence -d default -tAc 'select current_database();'
```

The app performs a read-only connection test (`SELECT version(), current_database()`) and creates
**no tables** — that is intentional for this scope.

## 9. Day-to-day commands

```bash
npm start               # start the API
npm run dev             # start the API with auto-reload
npm run db:up           # start the database (idempotent)
npm run db:down         # stop the database, keep its data
npm run db:migrate      # apply pending SQL migrations (safe to re-run)
npm run db:seed         # ensure default roles ADMIN / EMPLOYEE exist
docker compose ps       # container status
docker compose logs -f postgres
curl http://localhost:3000/hello
```

Stop the API with `Ctrl+C`; stop the database with `npm run db:down`.

## 9b. Database schema and migrations

```bash
npm run db:migrate                                  # apply migrations 001..005
docker exec emplence-postgres18 psql -U emplence -d default -c '\dt'
docker exec emplence-postgres18 psql -U emplence -d default -c 'select id, role_name, role_code from master_roles order by id;'
docker exec emplence-postgres18 psql -U emplence -d default -c 'select name, applied_at from schema_migrations order by name;'
```

Expected tables: `master_companies`, `master_roles`, `companies_locations`, `users`, plus
`schema_migrations` (bookkeeping). Expected roles: exactly two rows — `ADMIN` and `EMPLOYEE`.
Startup logs `[db] default roles already present` after the first run, which proves the seeding is
idempotent. Schema details: [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

## 10. Stop and reset

```bash
npm run db:down          # stop the container, keep the data volume
docker compose down -v   # stop and DELETE the data volume (fresh database next start)
npm run db:up            # start again; `default` is re-created empty
```

## 11. Ports and conflicts

Ports in use: API `3000`, PostgreSQL host port `5433`.

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN    # who holds the API port
lsof -nP -iTCP:5433 -sTCP:LISTEN    # who holds the database port
```

Free port 3000 (leftover API process):

```bash
pkill -f 'node src/server.js'
```

Run the API on another port:

```bash
PORT=3001 npm start
```

Run the database on another host port (then update `DATABASE_URL` in `.env.local` to match):

```bash
LOCAL_DB_PORT=5432 docker compose up -d
```

## 12. Use a PostgreSQL container you already have on 5432

```bash
docker ps --format '{{.Names}}\t{{.Ports}}'
```

If that container already has database `default`, point `.env.local` at it and keep TLS off:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/default
DB_SSL_MODE=disable
```

```bash
npm start
```

(The compose service from this repo uses `5433`, so it can run alongside such a container.)

## 13. Switch between local and production configuration

```bash
npm start                      # loads .env.local first, then .env  (local wins)
ENV_FILE=.env npm start        # production/hosted values only
ENV_FILE=.env.production npm start   # any single explicit env file
```

For a hosted database, `.env` must contain at minimum:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/default
DB_SSL_MODE=require
DB_SSL_REJECT_UNAUTHORIZED=true
# DB_SSL_CA_PATH=./certs/provider-ca.pem   # only for a private/self-signed CA
```

## 14. Troubleshooting

| Symptom | Command / fix |
| ------- | ------------- |
| `[db] connection failed: The server does not support SSL connections` | Local Docker DB has no TLS. Ensure `.env.local` exists with `DB_SSL_MODE=disable`, or run `ENV_FILE=.env.local npm start`. |
| `[db] connection failed: DATABASE_URL is not set` | `cp .env.local.example .env.local` |
| `[db] connection failed: connect ECONNREFUSED 127.0.0.1:5433` | Database not running or wrong port: `npm run db:up`, then `docker compose ps`. |
| `[db] connection failed: password authentication failed` | Credentials in `.env.local` do not match the container: use `emplence` / `emplence`, or reset with `docker compose down -v && npm run db:up`. |
| `[db] connection failed: database "default" does not exist` | Existing container lacks the DB. Use the compose service, or `docker exec -it <container> createdb -U <user> default`. |
| `[db] master tables are missing` | Schema not created yet: run `npm run db:migrate` (then restart the API). |
| `[seed] failed: relation "master_roles" does not exist` | Same cause: run `npm run db:migrate` before `npm run db:seed`. |
| `EADDRINUSE: address already in use :::3000` | `lsof -nP -iTCP:3000 -sTCP:LISTEN` then `pkill -f 'node src/server.js'`, or `PORT=3001 npm start`. |
| `failed to connect to the docker API` / `Cannot connect to the Docker daemon` | Docker Desktop is not running: `open -a Docker`, then `docker info`. |
| `port is already allocated` on `db:up` | Port 5433 is taken: `docker compose down`, or `LOCAL_DB_PORT=5440 docker compose up -d` (and update `DATABASE_URL`). |
| Container keeps restarting / unhealthy | `docker compose logs postgres`; then `docker compose down -v && npm run db:up`. |
| `Unsupported DB_SSL_MODE "..."` | Allowed values are `require` and `disable` only. |
| Changes to `src/` do not apply | You are running `npm start`; use `npm run dev` for auto-reload, or restart the process. |

## 15. Optional cleanup

```bash
npm run db:down
docker compose down -v
rm -f .env.local
```


## 16. Access `/hello` from an Android phone on the same Wi-Fi

Both devices must be on the **same Wi-Fi network**, and the API must listen on all interfaces
(the default).

### 1. Find this machine's LAN IP

```bash
ipconfig getifaddr en0        # macOS Wi-Fi  -> e.g. 192.168.1.22
# Linux:  ip -4 addr show | grep inet
```

### 2. Start the API (default: all interfaces)

```bash
npm start
# [server] listening on http://localhost:3000 (bind: all interfaces)
# [server] reachable on your network: http://192.168.1.22:3000
```

The second log line prints exactly the URL to use from the phone.

### 3. Open the endpoint on the phone

In Chrome (or any HTTP client) on the Android device:

```text
http://192.168.1.22:3000/hello
```

Expected:

```json
{
  "message": "Hello! Backend is running successfully."
}
```

### Sanity checks when the phone cannot load it

```bash
curl http://192.168.1.22:3000/hello        # on the Mac: must return 200 first
lsof -nP -iTCP:3000 -sTCP:LISTEN           # must show *:3000 — NOT 127.0.0.1:3000
```

| Check | Fix |
| ----- | --- |
| `lsof` shows `127.0.0.1:3000` | You started with `SERVER_HOST=127.0.0.1`; restart with `npm start` (no override). |
| Phone and Mac on different networks / guest Wi-Fi | Join the same SSID; guest and office networks often enable client isolation (the phone cannot reach the Mac). |
| macOS firewall is on (System Settings → Network → Firewall) | Allow incoming connections for `node` when prompted, or `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)`. |
| IP address changed after reconnecting | Re-run `ipconfig getifaddr en0` and use the new IP. |

### Android app notes (not just the browser)

- Android 9+ blocks **cleartext HTTP** by default. For debug builds add to
  `AndroidManifest.xml`: `<application android:usesCleartextTraffic="true" ...>`, or use a
  `network_security_config` limited to your dev host. Keep HTTPS in production.
- Physical phone base URL: `http://192.168.1.22:3000/` (Retrofit/OkHttp/Volley).
- Android **emulator** shortcut — the host machine is reachable as `10.0.2.2`:
  `http://10.0.2.2:3000/hello`.
- USB cable instead of Wi-Fi (works even on isolated networks):
  ```bash
  adb reverse tcp:3000 tcp:3000
  # then use http://localhost:3000/hello inside the device/emulator
  ```

### Keep a stable URL (optional)

DHCP may hand out a different address later. Add a DHCP reservation for the Mac in the router, or
re-check `ipconfig getifaddr en0` and update the app's base URL.

### Restrict the API to this machine only

```bash
SERVER_HOST=127.0.0.1 npm start     # not reachable from the phone
```

