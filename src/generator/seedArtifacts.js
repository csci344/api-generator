const fs = require("fs");
const path = require("path");
const { normalizeSeedDir } = require("../runtime/seedDir");

/**
 * Foreign-key-safe order: each referenced resource appears before dependents.
 */
function dependencyOrder(resources) {
  const byName = new Map(resources.map((r) => [r.name, r]));
  const result = [];
  const pending = new Set(resources.map((r) => r.name));

  while (pending.size) {
    const ready = [...pending].filter((name) => {
      const r = byName.get(name);
      const prereqs = r.fields
        .map((f) => f.references?.resource)
        .filter((x) => x && byName.has(x));
      return prereqs.every((p) => result.includes(p));
    });
    if (ready.length === 0) {
      throw new Error("Could not order resources for seed files (check for cyclic foreign keys).");
    }
    ready.sort();
    const pick = ready[0];
    result.push(pick);
    pending.delete(pick);
  }

  return result.map((name) => byName.get(name));
}

function sampleValueForField(field, rowIndex) {
  const n = rowIndex + 1;
  switch (field.type) {
    case "string":
      return `Sample ${field.name} ${n}`;
    case "text":
      return `Sample ${field.name} paragraph ${n}.`;
    case "integer":
      return String(n);
    case "number":
      return (12.99 + rowIndex).toFixed(2);
    case "boolean":
      return rowIndex % 2 === 0 ? "true" : "false";
    case "date":
      return `2026-04-0${n}`;
    case "datetime":
      return `2026-04-0${n}T12:00:00Z`;
    default:
      return `value${n}`;
  }
}

function escapeCsvCell(value) {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildSampleCsv(resource, rowsPerResource) {
  const headers = resource.fields.map((f) => f.name);
  const lines = [headers.join(",")];
  for (let i = 0; i < rowsPerResource; i += 1) {
    const cells = resource.fields.map((field) => {
      if (field.references) {
        return String(i + 1);
      }
      return escapeCsvCell(sampleValueForField(field, i));
    });
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

const USERS_CSV = [
  "username,password,seed_as",
  "user1,password,no",
  "user2,password,no",
  "user3,password,no",
  "user4,password,no",
  "",
].join("\n");

function buildSeedReadme(seedDirName) {
  return [
    "API Generator Seed Data",
    "=======================",
    "",
    `This folder contains sample CSV files that you can load into your data API.`,
    "",
    "Built-in accounts in a freshly generated database:",
    "- admin / password",
    "- user / password",
    "",
    "Extra demo users in users.csv:",
    "- user1 / password",
    "- user2 / password",
    "- user3 / password",
    "- user4 / password",
    "",
    "Load this data into the SQLite database by running:",
    "  npm run seed",
    "",
    "Recommended workflow:",
    "1. Run `npm run generate` after changing `api.config.yaml`.",
    "2. Edit the CSV files in this folder if you want custom seed data.",
    "3. Run `npm run seed` to insert the CSV rows into `data/app.db`.",
    "",
    "Notes:",
    "- `order.json` controls the import order for foreign-key dependencies.",
    "- `users.csv` must include `username` and `password` columns.",
    "- The built-in `admin` account is the default owner for ownership-enabled seeded rows.",
    "- The generated sample foreign-key values assume a fresh database.",
    "",
  ].join("\n");
}

function writeSeedArtifacts(projectRoot, config, options = {}) {
  if (options.noSeed) {
    return;
  }

  const seedDirName = normalizeSeedDir(options.seedDir, config.meta?.seedDir || "data");
  const seedDir = path.join(projectRoot, seedDirName);
  fs.mkdirSync(seedDir, { recursive: true });

  fs.writeFileSync(path.join(seedDir, "users.csv"), USERS_CSV);
  fs.writeFileSync(path.join(seedDir, "README.txt"), buildSeedReadme(seedDirName));

  const ordered = dependencyOrder(config.resources);
  const rowsPerResource =
    options.sampleRows === undefined ? 5 : Math.max(0, Number(options.sampleRows) || 0);

  const orderPayload = {
    apiVersion: "1",
    baseUrlEnv: "API_BASE",
    directory: seedDirName,
    resources: ordered.map((r) => ({
      name: r.name,
      path: r.path,
      file: `${r.fileBase}.csv`,
    })),
    usersFile: "users.csv",
    seedUserColumn: "seed_as",
  };
  fs.writeFileSync(path.join(seedDir, "order.json"), JSON.stringify(orderPayload, null, 2));

  for (const resource of ordered) {
    const csvPath = path.join(seedDir, `${resource.fileBase}.csv`);
    const body =
      rowsPerResource > 0
        ? buildSampleCsv(resource, rowsPerResource)
        : `${resource.fields.map((f) => f.name).join(",")}\n`;
    fs.writeFileSync(csvPath, body);
  }
}

module.exports = {
  writeSeedArtifacts,
  dependencyOrder,
};
