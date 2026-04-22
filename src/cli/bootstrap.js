#!/usr/bin/env node
const path = require("path");
const { initDatabase } = require("../runtime/db");
const { getCliOption } = require("../runtime/seedDir");
const { isManagedDatabaseEmpty, seedDatabase } = require("../runtime/seedData");

const projectRoot = path.resolve(__dirname, "../..");

async function main() {
  const argv = process.argv.slice(2);
  const seedDir = getCliOption(argv, "--seed-dir");
  const shouldSeed = String(process.env.AUTO_SEED_ON_EMPTY || "true").trim().toLowerCase();

  const db = await initDatabase(projectRoot);

  try {
    const isEmpty = await isManagedDatabaseEmpty(projectRoot, db);
    if (!isEmpty) {
      console.log("Database already has data. Skipping bootstrap seed.");
      return;
    }

    if (shouldSeed === "false" || shouldSeed === "0" || shouldSeed === "off") {
      console.log("Database is empty, but AUTO_SEED_ON_EMPTY is disabled. Schema only.");
      return;
    }

    const result = await seedDatabase(projectRoot, db, {
      seedDir,
      truncateExisting: false,
    });

    console.log(`Bootstrapped database from committed seed data in ${result.seedDir}.`);
    for (const line of result.lines) {
      console.log(line);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
