# API Generator

This folder is the backend that Railway deploys.

## Local

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Rebuild the local database from the default config:

```bash
npm run validate
npm run generate
npm run seed
```

## Examples

If you want to see what your API can look like with some sample data, do this:

```bash
npm run build:example -- --dir plants
```

Example folders live under `api-generator/examples`.
