# Deploying `api-generator` to Railway with committed sample data

This app can now switch between SQLite and PostgreSQL by environment variable, and it includes a Railway-safe bootstrap flow for committed seed data.

## The deployment idea

Use two separate pathways:

- local repo prep: generate artifacts and sample CSVs, then commit them
- Railway startup: create schema and seed only if the Postgres database is empty

That keeps deploys predictable and avoids wiping data on every restart.

## 1. Prepare commit-worthy artifacts locally

From [`api-generator`](/Users/svanwart/unca/csci344/spring2026/final-project/api-generator), run:

```bash
npm run validate
npm run generate:committed
```

That command:

- refreshes `generated/`
- refreshes `data/sample-data/`
- does **not** reset your current database

Commit these folders/files:

- `generated/`
- `public/generated-config.json`
- `data/sample-data/`
- your updated `api.config.yaml`

This gives Railway everything it needs to initialize schema and seed a fresh database from committed repo contents.

## 2. Make sure dependencies are installed

Because PostgreSQL support uses `pg`, run:

```bash
npm install
```

and commit the updated lockfile if it changed.

## 3. Create the Railway project

In Railway:

1. Create a new project.
2. Add your GitHub repo as a service.
3. Set the root directory to `api-generator`.
4. Add a `PostgreSQL` service to the same project.

## 4. Configure Railway variables

In the `api-generator` service, set:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=your-long-random-secret
NODE_ENV=production
AUTO_SEED_ON_EMPTY=true
```

Optional:

```env
DATABASE_SSL=true
```

If your Postgres service is not named `Postgres`, use that service name in the `DATABASE_URL` reference.

## 5. Use the Railway-safe start command

Set the start command to:

```bash
npm run start:railway
```

That script runs:

1. `npm run db:bootstrap`
2. `npm start`

The bootstrap step:

- creates the schema
- checks whether the managed tables are empty
- seeds from committed `data/sample-data/` only on an empty database

If the database already has data, it logs a skip message and leaves everything alone.

## 6. How the new commands fit together

### `npm run generate:committed`

Use this locally before committing.

Purpose:

- regenerate code and seed files for the repo
- avoid deleting your local DB while you prepare a deploy

### `npm run db:bootstrap`

Use this in Railway startup.

Purpose:

- initialize schema
- load committed sample CSVs only on first boot / empty DB

### `npm run seed`

Use this locally when you intentionally want to replace all current data with the seed CSV contents.

Purpose:

- destructive reseed
- good for local resets
- not the right tool for normal Railway restarts

## 7. Recommended workflow

When you change the API shape:

1. Edit `api.config.yaml`
2. Run `npm run validate`
3. Run `npm run generate:committed`
4. Review and edit `data/sample-data/*.csv` if needed
5. Commit the updated generated artifacts and seed files
6. Push to GitHub
7. Let Railway deploy with `npm run start:railway`

On a brand-new Railway Postgres database, the app will seed itself from the committed CSVs.

On later deploys, the bootstrap step will see existing data and skip reseeding.

## 8. Good defaults for class-project deployments

If you want predictable first deploys:

- commit `data/sample-data/`
- leave `AUTO_SEED_ON_EMPTY=true`
- use `npm run start:railway`

If later you want Railway to stop auto-seeding on fresh DBs:

```env
AUTO_SEED_ON_EMPTY=false
```

Then bootstrap becomes schema-only.

## 9. Important cautions

- Do not use `npm run seed` as the Railway start command.
- Do not use the destructive `generate` command during deploy.
- Regenerate and commit `generated/` locally before pushing API-shape changes.
- Keep `data/sample-data/` aligned with the current schema.

## References

- Railway PostgreSQL docs: [https://docs.railway.com/guides/postgresql](https://docs.railway.com/guides/postgresql)
- Railway variables docs: [https://docs.railway.com/variables](https://docs.railway.com/variables)
- Railway monorepo/root directory docs: [https://docs.railway.com/guides/monorepo](https://docs.railway.com/guides/monorepo)
- Railway start command docs: [https://docs.railway.com/deployments/start-command](https://docs.railway.com/deployments/start-command)
