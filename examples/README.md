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

From the root of your API Generator Directory, load one of the sample APIS:

```
npm run build:example -- --dir sneakers
npm run build:example -- --dir plants
```