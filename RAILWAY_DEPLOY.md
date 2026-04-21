# Deploying `api-generator` to Railway with PostgreSQL

This guide is for deploying the `api-generator` app to Railway and replacing the local SQLite database with Railway PostgreSQL.

## Current status

The app is **not PostgreSQL-ready yet**.

Right now the project is tightly coupled to SQLite:

- [`src/runtime/db.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/runtime/db.js) opens the database with `better-sqlite3`
- [`src/cli/generate.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/cli/generate.js) recreates `data/app.db`
- [`src/cli/seed.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/cli/seed.js) truncates tables using SQLite metadata and `sqlite_sequence`
- [`src/generator/artifacts.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/generator/artifacts.js) generates SQLite-flavored schema SQL such as `INTEGER PRIMARY KEY AUTOINCREMENT`
- [`src/runtime/crud.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/runtime/crud.js) depends on `better-sqlite3` APIs like `.prepare(...).get()`, `.all()`, `.run()`, `lastInsertRowid`, and `INSERT OR IGNORE`

Because of that, Railway deployment should be treated as a two-part task:

1. Make the app support PostgreSQL.
2. Deploy that PostgreSQL-capable version to Railway.

## Recommended approach

The cleanest path is to add a database adapter layer and switch by environment variable:

- local development: SQLite
- Railway / production: PostgreSQL via `DATABASE_URL`

Suggested environment variable:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://...
JWT_SECRET=replace-me
NODE_ENV=production
```

For local SQLite development:

```env
DATABASE_PROVIDER=sqlite
DB_PATH=./data/app.db
JWT_SECRET=dev-only-secret
```

## Code changes needed before Railway deploy

### 1. Replace `better-sqlite3` with a PostgreSQL client

Install a Postgres driver, typically:

```bash
npm install pg
```

Keep `better-sqlite3` only if you want dual-database support for local development.

### 2. Refactor `src/runtime/db.js`

Update [`src/runtime/db.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/runtime/db.js) so it:

- reads `DATABASE_PROVIDER`
- uses `process.env.DATABASE_URL` when provider is `postgres`
- creates the `users` and `shares` tables in PostgreSQL
- runs the generated schema against PostgreSQL
- exposes a shared query interface the rest of the app can use

For PostgreSQL, table ids should become:

```sql
id BIGSERIAL PRIMARY KEY
```

instead of:

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
```

### 3. Make generated schema PostgreSQL-compatible

Update [`src/generator/artifacts.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/generator/artifacts.js) so the schema generator can emit PostgreSQL SQL.

At minimum, convert these patterns:

- `INTEGER PRIMARY KEY AUTOINCREMENT` -> `BIGSERIAL PRIMARY KEY`
- `TEXT` can stay `TEXT`
- `REAL` -> `DOUBLE PRECISION` or `NUMERIC`
- booleans should be real PostgreSQL `BOOLEAN`

If you want to keep both engines, add a `buildSchemaSql(config, dialect)` style API.

### 4. Refactor CRUD/auth queries to use a common DB wrapper

[`src/runtime/auth.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/runtime/auth.js) and [`src/runtime/crud.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/runtime/crud.js) currently assume synchronous SQLite calls.

PostgreSQL with `pg` is async, so the routes will need to move to `await`.

Typical replacements:

- SQLite `.get(...)` -> Postgres query + `rows[0]`
- SQLite `.all(...)` -> Postgres query + `rows`
- SQLite `.run(...)` -> Postgres query result
- `lastInsertRowid` -> `RETURNING id`
- `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`

Example conversion:

```sql
INSERT INTO users (username, password_hash)
VALUES ($1, $2)
RETURNING id, username
```

### 5. Update the destructive generate flow

[`src/cli/generate.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/cli/generate.js) currently deletes and recreates the entire SQLite file.

That is fine locally, but it is not a good production pattern for Railway Postgres.

Recommended split:

- keep `npm run generate` for artifact generation only
- add a separate migration step for PostgreSQL schema creation
- do not drop production data automatically during deploy

For a class project, the simplest version is:

- `npm run generate` locally
- commit the generated artifacts
- have deployment run a safe schema-init script instead of destructive reset logic

### 6. Update the seed command for PostgreSQL

[`src/cli/seed.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/cli/seed.js) uses SQLite internals:

- `sqlite_master`
- `sqlite_sequence`
- synchronous prepared statements

For PostgreSQL:

- discover tables from `information_schema.tables` or a known list
- reset identities with `TRUNCATE ... RESTART IDENTITY CASCADE`
- switch inserts to parameterized async queries

## Suggested deployment workflow

Once the PostgreSQL refactor is done, use this Railway flow.

### 1. Push the repo to GitHub

Railway deployment is easiest from a GitHub repo.

### 2. Create a Railway project

In Railway:

1. Create a new project.
2. Add your GitHub repo as a service.
3. Set the service root to `api-generator` if Railway asks for a root directory.

### 3. Add PostgreSQL

Inside the same Railway project:

1. Click `New`.
2. Add a `PostgreSQL` database service.

Railway will provide connection variables including `DATABASE_URL`.

### 4. Reference the Postgres `DATABASE_URL` from the app service

In the `api-generator` Railway service, add variables such as:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=your-long-random-secret
NODE_ENV=production
```

If your Postgres service is named differently, use that service name in the reference variable.

### 5. Set the start command

The app already has:

```json
"start": "node src/server.js"
```

So Railway can usually use the default Node start behavior. If needed, set the start command to:

```bash
npm start
```

### 6. Make sure the app listens on `PORT`

This is already handled in [`src/server.js`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator/src/server.js):

```js
const requestedPort = Number(process.env.PORT || 3100);
```

That part is Railway-friendly already.

### 7. Run schema setup before first production start

Before the first successful deploy, your PostgreSQL schema must exist.

You have two reasonable options:

- create a one-time script like `npm run db:init:postgres`
- use a proper migration tool such as Knex, Prisma, Drizzle, or node-pg-migrate

For this project, a small `db:init:postgres` script is probably enough.

That script should:

- connect with `DATABASE_URL`
- create `users`
- create `shares`
- create all generated resource tables
- optionally insert default users if they do not already exist

### 8. Deploy and verify

After deployment:

1. Open the Railway-generated app URL.
2. Visit `/api/docs`.
3. Test `POST /auth/login`.
4. Test one generated list route such as `/api/plants`.
5. Confirm records are actually stored in Railway Postgres.

## Minimal production env vars

These are the minimum variables I would expect on Railway:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<long-random-secret>
NODE_ENV=production
```

Optional:

```env
PORT=3000
```

Railway usually provides `PORT` automatically, so you normally do not need to set it yourself.

## Important cautions

- Do not deploy the current SQLite-only version and assume Railway Postgres will work automatically.
- Do not keep the current destructive `generate` behavior in a production deploy step.
- Do not hard-code secrets; use Railway variables.
- Do not commit a real production `DATABASE_URL` or `JWT_SECRET`.

## Short version

If you want the fastest route for the project:

1. Add PostgreSQL support in the runtime.
2. Change schema generation to emit PostgreSQL-compatible SQL.
3. Change CRUD/auth code to async queries.
4. Add Railway PostgreSQL to the project.
5. Point `DATABASE_URL` at Railway Postgres.
6. Deploy with `npm start`.

## References

- Railway PostgreSQL docs: [https://docs.railway.com/guides/postgresql](https://docs.railway.com/guides/postgresql)
- Railway variables docs: [https://docs.railway.com/variables](https://docs.railway.com/variables)
- Railway start command docs: [https://docs.railway.com/deployments/start-command](https://docs.railway.com/deployments/start-command)
- Railway deployment dependency notes: [https://docs.railway.com/deployments/deployment-actions](https://docs.railway.com/deployments/deployment-actions)
