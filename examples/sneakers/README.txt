API Generator Seed Data
=======================

This folder contains sample CSV files that you can load into your data API.

When you run `npm run generate` again, previous seed files in this folder are moved into
`archive/<timestamp>/` so you can recover older versions if needed.

Built-in accounts in a freshly generated database:
- admin / password
- user / password

Extra demo users in users.csv:
- user1 / password
- user2 / password
- user3 / password
- user4 / password

Load this data into the SQLite database by running:
  npm run seed

Recommended workflow:
1. Run `npm run generate` after changing `api.config.yaml`.
2. Edit the CSV files in this folder if you want custom seed data.
3. Run `npm run seed` to insert the CSV rows into `data/app.db`.

Notes:
- `order.json` controls the import order for foreign-key dependencies.
- `users.csv` must include `username` and `password` columns.
- The built-in `admin` account is the default owner for ownership-enabled seeded rows.
- The generated sample foreign-key values assume a fresh database.
