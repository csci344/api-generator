# API Generator Starter

This project is a starter backend app for a declarative CRUD API generator. Students define their API in `api.config.yaml`, run the generator, and then start the server.

## What is built in

The starter app provides these framework features automatically:

- user accounts in the `users` table
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- a global `shares` table for shareable resources
- SQLite-backed storage in `data/app.db`

Students do not need to declare `users` or `shares` in the DSL.

## How the project is organized

This starter is split into three parts:

- `api.config.yaml`: the DSL students edit
- `generated/`: build output recreated by `npm run generate`
- `src/`: hand-written app/runtime code

Inside `src/`, there are two especially important areas:

- `src/generator/` plus `src/cli/generate.js`: code that reads the DSL and writes `generated/`
- `src/runtime/` plus `src/server.js`: the actual Express app, auth, SQLite setup, and generic CRUD runtime

There is also a dedicated hand-written extension point for custom Express work:

- `src/routes/custom.js`

Students who want to move beyond the generated CRUD API should add new Express endpoints there, not inside `generated/`.

## Student workflow

1. Edit `api.config.yaml`
2. Run `npm install`
3. Run `npm run validate`
4. Run `npm run generate`
5. (Optional) Run `npm run seed` to load the sample CSV data directly into SQLite (see [Seed sample data](#seed-sample-data-optional))
6. Run `npm start`
7. Open `/api/docs` for interactive API docs and request testing

Important: `npm run generate` regenerates the code and recreates the local SQLite database from scratch. Any existing data in `data/app.db` will be deleted.

Important: because `npm run generate` recreates the database from the generated schema, custom schema or data that lives outside the generated model will need a separate migration story later.

## Validate the DSL

Before generating the API, students can validate their DSL file:

```bash
npm run validate
```

This checks:

- YAML syntax
- required resource structure
- valid field types
- valid CRUD operation names
- valid permissions policy names
- foreign-key references to other resources
- relation targets
- `shareable: true` when `owner_or_shared` is used

If the config is valid, the validator prints a short summary of the resources and the built-in framework features that are added automatically.

## Generate the API

```bash
npm run generate
```

This command now does three things:

- regenerates the files in `generated/`
- writes sample **seed CSV** files under `data/` by default (one per resource plus `users.csv` and `order.json`)
- deletes and recreates the local SQLite database in `data/app.db` based on the latest schema

Each generated database also includes two built-in login accounts right away:
- `admin` / `password`
- `user` / `password`

This makes the YAML file the source of truth for the starter project, but it also means any local data is reset each time you generate.
Before it runs, the CLI asks for confirmation. For scripted usage, pass `--yes` to skip the prompt.
When `npm start` or `npm run dev` finds that the requested port is already in use, the server automatically tries the next available port and prints the chosen URL.

Do not hand-edit files under `generated/`; they are build artifacts and will be overwritten.

Optional flags:

- `--no-seed` — skip writing the CSV seed templates
- `--headers-only` — write CSV headers only (no sample data rows)
- `--seed-dir=<dir>` — write the CSV seed templates under a different project-relative directory

## Seed sample data (optional)

After `npm run generate`, the `data/` folder contains spreadsheet-friendly CSV files and the `seed.js` script can insert those rows directly into the local SQLite database. If you generated the files elsewhere with `--seed-dir`, `npm run seed` will reuse that same directory automatically.

1. Run `npm run generate`
2. Run `npm run seed`
3. Start the server when you are ready to browse or test the API: `npm start`

Both `generate` and `seed` now ask for confirmation before they modify database data. For non-interactive runs, use `--yes`.

The generated database always includes two built-in users: `admin` / `password` and `user` / `password`. The generated `users.csv` contains extra demo users (`user1` through `user4`) that can be added by running `npm run seed`. During seeding, the built-in `admin` account is treated as the seed owner, so ownership-enabled records are inserted with `admin` as their owner. These passwords are for local development only. Do not reuse these patterns for real accounts.

**Foreign keys:** sample rows use `1`, `2`, ... in FK columns, which match **auto-increment ids** when the database is empty before seeding (same order as `data/order.json` by default). If you add rows manually first, edit the CSV or reset with `npm run generate` before seeding again.

## Data spreadsheet (browser)

The app includes a simple **Tabulator**-based grid at `/data-grid.html` (also linked from the home page). Open that URL **while `npm start` is running** so the page and the API share the same origin. If the server falls back to another port, use the URL printed in the startup log. If you open the HTML from another server (or a `file://` URL), add a query parameter, for example: `data-grid.html?api=http://127.0.0.1:3100`, or set `window.__API_BASE__` in `data-grid.html` before the main script loads.

After you log in with `POST /auth/login` (same credentials you would use from Swagger), you can:

- pick a resource and load rows (`GET`)
- add rows (`POST`), edit cells (`PATCH`), and delete rows (`DELETE`)

The page also includes a separate **User management** form for creating accounts through `POST /auth/register`. That form is intentionally separate from the spreadsheet grid so built-in auth stays distinct from DSL-generated resources. Passwords are sent once to the server and hashed there; the browser does not store plaintext passwords.

All requests use the **same REST API** as any other client; the page is a convenience UI only. The browser loads schema from `GET /api/generator-config` (with fallbacks; field names and paths come from your last `npm run generate`). If those URLs return 404, stop the server and run `npm start` again from this project so Node picks up the latest `src/server.js`.

To verify the server is the right one, open `/api/openapi.json` on the same host and port where the app started; it should return JSON. The data grid also loads `/generated-config.json` — a static copy of the config written by `npm run generate` into `public/` (so it works even if Express route handlers are out of date). Restart `npm start` after pulling changes.

For local development only; do not expose this pattern unchanged on a public production server without proper security review.

## Interactive docs

The starter app serves Swagger-style interactive docs at:

```text
http://localhost:<current-port>/api/docs
```

This page is similar to FastAPI's built-in docs:

- it lists all generated endpoints
- it shows request and response schemas
- it lets students try requests directly in the browser
- it supports bearer-token auth through the "Authorize" button

Useful endpoints:

- `/api/docs`: interactive tester
- `/api/openapi.json`: raw OpenAPI document
- `/api/docs.json`: simple generated route summary

Custom endpoints added in `src/routes/custom.js` are hand-written Express routes. They are not generated from the DSL, and they will not automatically appear in the generated docs unless you document them separately.

## Student progression

One intended path through this starter is:

1. define app data in `api.config.yaml`
2. generate a CRUD backend
3. explore and test it with Swagger and the data grid
4. add hand-written Express routes in `src/routes/custom.js` when ready for more backend control

## Current DSL features

- resources with `name`, `path`, `fields`, and `operations`
- basic field types: `string`, `text`, `integer`, `number`, `boolean`, `date`, `datetime`
- per-operation permissions policies:
  - `public`
  - `user`
  - `owner`
  - `owner_or_shared`
- `shareable: true`
- basic relations like `name: genre` + `references: genres` (included in responses by default)

## Example auth flow

Register:

```bash
curl -X POST http://localhost:3100/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password"}'
```

Login:

```bash
curl -X POST http://localhost:3100/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password"}'
```

Create a protected record with the returned token:

```bash
curl -X POST http://localhost:3100/api/memory-entries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"title":"North Carolina Arboretum","description":"Spring walk"}'
```

Share a record with another user:

```bash
curl -X POST http://localhost:3100/api/memory-entries/1/shares \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"username":"bob"}'
```

## Railway note

This starter app is currently optimized for local SQLite development. The code structure is intentionally small so a Postgres adapter can be added later behind `DATABASE_URL` for optional Railway deployment.
