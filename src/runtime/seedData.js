const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { normalizeSeedDir } = require("./seedDir");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] !== undefined ? cells[j] : "";
    });
    rows.push(row);
  }
  return rows;
}

function coerceValue(db, field, raw) {
  const s = String(raw).trim();
  if (s === "") {
    return undefined;
  }
  const storageType = field.storageType || field.type;
  switch (storageType) {
    case "boolean": {
      const lower = s.toLowerCase();
      if (lower === "true" || s === "1") {
        return db.normalizeBoolean(true);
      }
      if (lower === "false" || s === "0") {
        return db.normalizeBoolean(false);
      }
      throw new Error(`Invalid boolean for ${field.name}: ${raw}`);
    }
    case "integer": {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid integer for ${field.name}: ${raw}`);
      }
      return n;
    }
    case "number": {
      const x = parseFloat(s);
      if (!Number.isFinite(x)) {
        throw new Error(`Invalid number for ${field.name}: ${raw}`);
      }
      return x;
    }
    case "string":
    case "text":
    case "date":
    case "datetime":
    default:
      return s;
  }
}

function rowToBody(db, resource, row) {
  const body = {};
  for (const field of resource.fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field.name)) {
      continue;
    }
    const raw = row[field.name];
    const value = coerceValue(db, field, raw);
    if (value === undefined) {
      if (field.required) {
        throw new Error(`Missing required field ${resource.type}.${field.name}`);
      }
      continue;
    }
    body[field.name] = value;
  }
  return body;
}

function findResource(config, resourceType) {
  return config.resources.find((r) => r.type === resourceType);
}

async function truncateAllTables(db) {
  const tables = await db.listTables();
  await db.clearTables(tables);
}

async function insertUsers(db, userRows, seedCol) {
  const adminPasswordHash = await bcrypt.hash("password", 10);
  const preparedRows = [];
  for (const row of userRows) {
    const username = String(row.username || "").trim();
    const password = String(row.password || "");
    if (!username || !password) {
      throw new Error("Each row in users.csv must include username and password.");
    }
    preparedRows.push({
      username,
      passwordHash: await bcrypt.hash(password, 10),
      isSeedUser: String(row[seedCol] || "").trim().toLowerCase() === "yes",
    });
  }

  const userIdByUsername = new Map();

  const existingAdmin = await db.get("SELECT id FROM users WHERE username = ?", ["admin"]);
  if (existingAdmin) {
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [
      adminPasswordHash,
      existingAdmin.id,
    ]);
    userIdByUsername.set("admin", Number(existingAdmin.id));
  } else {
    const adminResult = await db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      ["admin", adminPasswordHash]
    );
    userIdByUsername.set("admin", Number(adminResult.lastInsertRowid));
  }

  for (const row of preparedRows) {
    if (row.username === "admin") {
      continue;
    }
    const existing = await db.get("SELECT id FROM users WHERE username = ?", [row.username]);
    if (existing) {
      await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [
        row.passwordHash,
        existing.id,
      ]);
      userIdByUsername.set(row.username, Number(existing.id));
      continue;
    }

    const result = await db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [row.username, row.passwordHash]
    );
    userIdByUsername.set(row.username, Number(result.lastInsertRowid));
  }

  const seedUser = { username: "admin", isSeedUser: true };

  return {
    count: preparedRows.length + (preparedRows.some((row) => row.username === "admin") ? 0 : 1),
    seedUser,
    seedUserId: userIdByUsername.get("admin"),
  };
}

async function insertResourceRows(db, resource, rows, ownerId) {
  const fieldNames = resource.fields.map((field) => field.name);
  const insertFieldNames = resource.ownershipEnabled ? ["owner_id", ...fieldNames] : fieldNames;
  const placeholders = insertFieldNames.map(() => "?").join(", ");

  for (const [index, row] of rows.entries()) {
    const body = rowToBody(db, resource, row);
    const values = fieldNames.map((fieldName) => body[fieldName] ?? null);

    if (resource.ownershipEnabled) {
      values.unshift(ownerId);
    }

    try {
      await db.run(
        `INSERT INTO ${resource.tableName} (${insertFieldNames.join(", ")}) VALUES (${placeholders})`,
        values
      );
    } catch (err) {
      throw new Error(`Could not insert ${resource.type} row ${index + 1}: ${err.message}`);
    }
  }
}

function loadGeneratedConfig(projectRoot) {
  const configPath = path.join(projectRoot, "generated", "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing generated/config.json. Run `npm run generate` first.");
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function resolveSeedPaths(projectRoot, config, seedDirOverride) {
  const seedDir = normalizeSeedDir(seedDirOverride, config.meta?.seedDir || "data/sample-data");
  const orderPath = path.join(projectRoot, seedDir, "order.json");
  if (!fs.existsSync(orderPath)) {
    throw new Error(
      `Missing ${seedDir}/order.json. Run \`npm run generate\` (without --no-seed) first.`
    );
  }

  const order = JSON.parse(fs.readFileSync(orderPath, "utf8"));
  const usersPath = path.join(projectRoot, seedDir, order.usersFile || "users.csv");
  return { seedDir, orderPath, order, usersPath };
}

async function seedDatabase(projectRoot, db, options = {}) {
  const config = loadGeneratedConfig(projectRoot);
  const { seedDir, order, usersPath } = resolveSeedPaths(projectRoot, config, options.seedDir);
  const userRows = parseCsvFile(usersPath);
  if (userRows.length === 0) {
    throw new Error("No rows in users.csv.");
  }

  if (options.truncateExisting !== false) {
    await truncateAllTables(db);
  }

  const seedCol = order.seedUserColumn || "seed_as";
  const { count, seedUser, seedUserId } = await insertUsers(db, userRows, seedCol);
  const summary = [`Seeded ${count} user row(s) -> users`];

  for (const entry of order.resources) {
    const resource = findResource(config, entry.type);
    if (!resource) {
      summary.push(`Skipping unknown resource type ${entry.type} in order.json`);
      continue;
    }
    const csvPath = path.join(projectRoot, seedDir, entry.file);
    if (!fs.existsSync(csvPath)) {
      summary.push(`Missing ${entry.file}, skipping.`);
      continue;
    }

    const rows = parseCsvFile(csvPath);
    await insertResourceRows(db, resource, rows, seedUserId);
    summary.push(`Seeded ${rows.length} row(s) -> ${resource.path}`);
  }

  summary.push(`Seed owner: ${seedUser.username}`);
  return {
    seedDir,
    seedUser: seedUser.username,
    lines: summary,
  };
}

async function isManagedDatabaseEmpty(projectRoot, db) {
  const config = loadGeneratedConfig(projectRoot);
  const tableNames = ["users", "shares", ...(config.resources || []).map((resource) => resource.tableName)];

  for (const tableName of new Set(tableNames)) {
    const row = await db.get(`SELECT COUNT(*) AS count FROM ${tableName}`);
    if (Number(row?.count || 0) > 0) {
      return false;
    }
  }

  return true;
}

module.exports = {
  isManagedDatabaseEmpty,
  seedDatabase,
};
