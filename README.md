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

## Student workflow

1. Edit `api.config.yaml`
2. Run `npm install`
3. Run `npm run validate`
4. Run `npm run generate`
5. Run `npm start`
6. Open `/api/docs` for interactive API docs and request testing

Important: `npm run generate` regenerates the code and recreates the local SQLite database from scratch. Any existing data in `data/app.db` will be deleted.

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
- valid auth policy names
- foreign-key references to other resources
- relation targets
- `shareable: true` when `owner_or_shared` is used

If the config is valid, the validator prints a short summary of the resources and the built-in framework features that are added automatically.

## Generate the API

```bash
npm run generate
```

This command now does two things:

- regenerates the files in `generated/`
- deletes and recreates the local SQLite database in `data/app.db` based on the latest schema

This makes the YAML file the source of truth for the starter project, but it also means any local data is reset each time you generate.

## Interactive docs

The starter app serves Swagger-style interactive docs at:

```text
http://localhost:3100/api/docs
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

## Current DSL features

- resources with `name`, `path`, `fields`, and `operations`
- basic field types: `string`, `text`, `integer`, `number`, `boolean`, `date`, `datetime`
- per-operation auth policies:
  - `public`
  - `user`
  - `owner`
  - `owner_or_shared`
- `shareable: true`
- basic `belongsTo` relations
- response views like `summary` and `detail`

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
