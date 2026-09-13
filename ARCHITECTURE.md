# Architecture

`jwt-pizza-service` is the backend API for the JWT Pizza application. It is a
single Node.js/Express service backed by a MySQL database, plus an
integration with an external "pizza factory" service that actually produces
orders. It has no server-side rendering — it exists purely to be consumed by
the `jwt-pizza` frontend (or any other HTTP client).

## Component overview

```
                   ┌─────────────────────┐
   HTTP clients ──▶│   Express app        │
 (jwt-pizza web,   │   src/service.js     │
  curl, etc.)      └─────────┬────────────┘
                              │
              ┌───────────────┼───────────────┬───────────────┐
              ▼               ▼               ▼               ▼
        authRouter       userRouter      orderRouter    franchiseRouter
     (register/login/   (profile CRUD)   (menu, diner    (franchises &
      logout, JWTs)                       orders)          stores)
              │               │               │               │
              └───────────────┴───────┬───────┴───────────────┘
                                       ▼
                              database/database.js
                                 (DB singleton)
                                       │
                                       ▼
                                 MySQL (mysql2)
                                       ▲
                                       │ schema defined by
                              database/dbModel.js

  orderRouter also calls out to an external HTTP service:
        orderRouter ──POST /api/order──▶ JWT Pizza Factory (config.factory.url)
```

## Request lifecycle

1. **Entry point** — [src/index.js](src/index.js) starts the HTTP listener,
   delegating the actual app construction to `src/service.js`.
2. **App wiring** — [src/service.js](src/service.js) builds the Express app:
   - Parses JSON bodies (`express.json()`).
   - Runs `setAuthUser` on every request to attach `req.user` from a bearer
     JWT, if present and still valid in the DB (see Auth below).
   - Sets permissive CORS headers.
   - Mounts four routers under `/api`: `/api/auth`, `/api/user`,
     `/api/order`, `/api/franchise`.
   - Exposes `/api/docs`, which aggregates each router's self-declared
     `docs` array into a single machine-readable API reference, and `/`
     for a simple welcome/version check.
   - Ends with a catch-all 404 handler and a generic error handler that
     serializes `err.statusCode`/`err.message` (defaulting to 500).
3. **Routers** (`src/routes/*.js`) hold the route definitions and request
   validation/authorization logic. Each router:
   - Declares a `docs` array describing its endpoints (method, path,
     description, example curl, sample response) — this is what powers
     `/api/docs`.
   - Wraps async handlers in `asyncHandler` (`src/endpointHelper.js`) so
     rejected promises are forwarded to Express's error handler instead of
     crashing the process.
   - Delegates all persistence to the `DB` singleton — routers contain no
     SQL themselves.
4. **Database layer** — `src/database/database.js` exports a single `DB`
   instance (a thin data-access layer, not a full ORM) that opens a fresh
   MySQL connection per call via `mysql2/promise`, runs one or more
   parameterized queries, and closes the connection. `src/database/dbModel.js`
   holds the `CREATE TABLE IF NOT EXISTS` statements that define the schema.
5. **External integration** — creating an order (`POST /api/order`) writes
   the order to the local DB, then forwards it to the external JWT Pizza
   Factory (`config.factory.url`) using an API key, returning the factory's
   response (a fulfillment JWT and report link) to the client.

## Modules

| Path | Responsibility |
|---|---|
| [src/index.js](src/index.js) | Process entry point; starts the HTTP server. |
| [src/service.js](src/service.js) | Builds and configures the Express `app` (middleware, routing, error handling). |
| [src/config.js](src/config.js) | Deployment configuration: JWT secret, DB connection info, factory URL/API key. Not committed with real secrets in production — see Configuration below. |
| [src/version.json](src/version.json) | Service version string surfaced via `/` and `/api/docs`. |
| [src/endpointHelper.js](src/endpointHelper.js) | Shared `asyncHandler` wrapper and `StatusCodeError` (an `Error` subclass carrying an HTTP status code). |
| [src/model/model.js](src/model/model.js) | Shared domain constants — the `Role` enum (`diner`, `franchisee`, `admin`). |
| [src/routes/authRouter.js](src/routes/authRouter.js) | Registration, login, logout; issues/validates JWTs; exposes `setAuthUser` middleware and `authenticateToken` guard used by the other routers. |
| [src/routes/userRouter.js](src/routes/userRouter.js) | Get/update the authenticated user's profile. |
| [src/routes/orderRouter.js](src/routes/orderRouter.js) | Pizza menu (read/admin-write) and diner order creation/listing; talks to the external factory service. |
| [src/routes/franchiseRouter.js](src/routes/franchiseRouter.js) | Franchise and store CRUD, revenue rollups. |
| [src/database/database.js](src/database/database.js) | `DB` singleton: connection management, schema bootstrap, and every SQL query used by the app. |
| [src/database/dbModel.js](src/database/dbModel.js) | Table DDL for `auth`, `user`, `menu`, `franchise`, `store`, `userRole`, `dinerOrder`, `orderItem`. |
| [src/init.js](src/init.js) | One-off CLI script to seed an admin user (`node init.js <name> <email> <password>`). |

## Data model

- **user** — id, name, email, hashed password (bcrypt).
- **userRole** — join table granting a user a `Role` (`diner`/`franchisee`/
  `admin`), optionally scoped to an `objectId` (e.g. a franchise id for
  franchisees).
- **franchise** / **store** — a franchise owns zero or more stores;
  franchisees are users with a `franchisee` role scoped to that franchise.
- **menu** — global pizza menu items (title, image, price, description).
- **dinerOrder** / **orderItem** — an order placed by a diner at a specific
  store, with one or more line items referencing the menu.
- **auth** — active JWT signatures keyed by user id, used as a server-side
  allow-list so tokens can be invalidated on logout (see Auth below).

## Authentication & authorization

- Passwords are hashed with **bcrypt** before storage; plaintext passwords
  are never persisted.
- On register/login, the server issues a **JWT** (via `jsonwebtoken`,
  signed with `config.jwtSecret`) containing the user object and roles, and
  records the token's signature in the `auth` table (`DB.loginUser`).
- On every request, `setAuthUser` (in `authRouter.js`) reads the bearer
  token, checks it's still present in the `auth` table (`DB.isLoggedIn`) —
  so a logged-out token stops working even though the JWT itself would
  still verify — then decodes it into `req.user` and attaches an
  `isRole(role)` helper.
- `authRouter.authenticateToken` is used as route middleware to require a
  valid `req.user` (401 otherwise).
- Fine-grained authorization (e.g. "only an admin or the franchise's own
  admins can create a store") is checked inline in each route handler using
  `req.user.isRole(Role.Admin)` and ownership checks, throwing
  `StatusCodeError` (403/404) on failure.
- Logout (`DELETE /api/auth`) removes the token's row from `auth`,
  immediately revoking it.

## Configuration

`src/config.js` is a plain CommonJS module (not environment variables) with
three sections:
- `jwtSecret` — signing key for issued JWTs.
- `db.connection` — MySQL host/socket, user, password, database name,
  connect timeout; `db.listPerPage` — default pagination size.
- `factory` — base URL and API key for the external JWT Pizza Factory that
  fulfills orders.

This file is expected to be supplied/edited per-deployment (see README.md)
rather than derived from the environment.

## Deployment

[deployService.sh](deployService.sh) is a manual deployment script: it
packages `src/*` plus the root `*.json` files into a `dist/` folder, copies
it to a remote Ubuntu host over `scp`/`ssh`, runs `npm install` there, and
restarts the service under `pm2`. There is no containerization or CI/CD
pipeline defined in this repository — deployment is a direct
push-to-server operation.

## Notable characteristics / constraints

- **No ORM** — all SQL is written by hand in `database.js` using
  parameterized queries via `mysql2`.
- **Per-call connections** — a new MySQL connection is opened and closed
  for almost every `DB` method rather than using a pool; simple but not
  optimized for high concurrency.
- **Self-documenting API** — each router exports a `docs` array consumed by
  `GET /api/docs`, so the endpoint list and examples in this document can
  drift from `/api/docs`'s live output; when in doubt, prefer `/api/docs`.
- **Stateless except for the `auth` allow-list** — the JWT itself carries
  the full user/roles payload, so most of the app needs no per-request DB
  lookup beyond the login-status check.
