# Example APIs

Store alternate API examples here, with each example keeping its YAML and seed data together.

Recommended structure:

```text
examples/
  plants/
    api.config.yaml
    seed/
      users.csv
      plant-types.csv
      plants.csv
      order.json
  sneakers/
    api.config.yaml
    seed/
      users.csv
      brands.csv
      sneakers.csv
      order.json
```

Use one with:

```bash
npm run validate -- --config examples/plants/api.config.yaml
npm run generate -- --config examples/plants/api.config.yaml --seed-dir examples/plants/seed
npm run generate:committed -- --config examples/plants/api.config.yaml --seed-dir examples/plants/seed
npm run seed -- --seed-dir examples/plants/seed
```

Railway can activate one by setting:

```env
ACTIVE_API_CONFIG=examples/plants/api.config.yaml
ACTIVE_SEED_DIR=examples/plants/seed
```
