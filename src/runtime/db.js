const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DEFAULT_USERS = [
  { username: "admin", password: "password" },
  { username: "user", password: "password" },
];

async function initDatabase(projectRoot, options = {}) {
  const provider = resolveDatabaseProvider();
  if (provider === "postgres") {
    return initPostgresDatabase(projectRoot, options);
  }
  return initSqliteDatabase(projectRoot, options);
}

async function recreateDatabase(projectRoot) {
  const provider = resolveDatabaseProvider();
  if (provider === "postgres") {
    await resetPostgresDatabase(projectRoot);
  } else {
    resetSqliteDatabase(projectRoot);
  }

  const db = await initDatabase(projectRoot);
  await createDefaultUsers(db);
  await db.close();

  return provider === "postgres"
    ? process.env.DATABASE_URL || "postgresql://configured-via-environment"
    : getDatabasePath(projectRoot);
}

function resolveDatabaseProvider() {
  const provider = String(process.env.DATABASE_PROVIDER || "").trim().toLowerCase();
  if (provider === "postgres" || provider === "postgresql" || provider === "pg") {
    return "postgres";
  }
  if (provider === "sqlite" || provider === "sqlite3") {
    return "sqlite";
  }
  return process.env.DATABASE_URL ? "postgres" : "sqlite";
}

function getDatabasePath(projectRoot, overridePath) {
  const dataDir = path.join(projectRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return overridePath || process.env.DB_PATH || path.join(dataDir, "app.db");
}

async function initSqliteDatabase(projectRoot, options = {}) {
  // Lazy-load better-sqlite3 so Postgres mode does not depend on the SQLite native binary.
  const Database = require("better-sqlite3");
  const dbPath = getDatabasePath(projectRoot, options.dbPath);
  const sqlite = new Database(dbPath, {
    readonly: Boolean(options.readonly),
    fileMustExist: Boolean(options.fileMustExist),
  });

  const db = createSqliteAdapter(sqlite, dbPath);
  if (options.initializeSchema !== false) {
    await db.exec("PRAGMA foreign_keys = ON");
    await initializeCommonSchema(projectRoot, db);
  }
  return db;
}

async function initPostgresDatabase(projectRoot, options = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required when DATABASE_PROVIDER is set to postgres."
    );
  }

  // Lazy-load pg so SQLite-only local work still runs without requiring pg at startup.
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    ...(process.env.PGSSLMODE === "disable" ? {} : buildPostgresSslConfig()),
  });
  const db = createPostgresAdapter(pool);

  if (options.initializeSchema !== false) {
    await initializeCommonSchema(projectRoot, db);
  }

  return db;
}

function buildPostgresSslConfig() {
  const explicit = String(process.env.DATABASE_SSL || "").trim().toLowerCase();
  if (explicit === "false" || explicit === "0" || explicit === "off") {
    return { ssl: false };
  }
  if (explicit === "true" || explicit === "1" || explicit === "on") {
    return { ssl: { rejectUnauthorized: false } };
  }
  return {};
}

async function initializeCommonSchema(projectRoot, db) {
  await db.exec(builtInSchemaForDialect(db.dialect));

  const generatedSchema = loadGeneratedSchema(projectRoot, db.dialect);
  if (generatedSchema) {
    await db.exec(generatedSchema);
  }
}

function builtInSchemaForDialect(dialect) {
  if (dialect === "postgres") {
    return `
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS shares (
        id BIGSERIAL PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id BIGINT NOT NULL,
        shared_with_user_id BIGINT NOT NULL,
        shared_by_user_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(resource_type, resource_id, shared_with_user_id),
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `;
  }

  return `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      shared_with_user_id INTEGER NOT NULL,
      shared_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(resource_type, resource_id, shared_with_user_id),
      FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;
}

function loadGeneratedSchema(projectRoot, dialect) {
  const generatedDir = path.join(projectRoot, "generated");
  const preferredPath = path.join(generatedDir, `schema.${dialect}.sql`);
  if (fs.existsSync(preferredPath)) {
    return fs.readFileSync(preferredPath, "utf8");
  }

  const legacyPath = path.join(generatedDir, "schema.sql");
  if (!fs.existsSync(legacyPath)) {
    return "";
  }

  const sql = fs.readFileSync(legacyPath, "utf8");
  return dialect === "postgres" ? translateSqliteSchemaToPostgres(sql) : sql;
}

function translateSqliteSchemaToPostgres(sql) {
  return String(sql)
    .replaceAll(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY")
    .replaceAll(/\bREAL\b/g, "DOUBLE PRECISION")
    .replaceAll(/\bINTEGER\b/g, "BIGINT");
}

function resetSqliteDatabase(projectRoot) {
  const dbPath = getDatabasePath(projectRoot);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

async function resetPostgresDatabase(projectRoot) {
  const db = await initPostgresDatabase(projectRoot, { initializeSchema: false });
  try {
    const tableNames = await getManagedTableNames(projectRoot);
    if (tableNames.length === 0) {
      return;
    }

    const sql = tableNames
      .map((tableName) => `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)} CASCADE`)
      .join(";\n");
    await db.exec(sql);
  } finally {
    await db.close();
  }
}

async function getManagedTableNames(projectRoot) {
  const generatedConfigPath = path.join(projectRoot, "generated", "config.json");
  const tableNames = ["shares", "users"];
  if (!fs.existsSync(generatedConfigPath)) {
    return tableNames;
  }

  const config = JSON.parse(fs.readFileSync(generatedConfigPath, "utf8"));
  for (const resource of config.resources || []) {
    if (resource.tableName) {
      tableNames.unshift(resource.tableName);
    }
  }

  return [...new Set(tableNames)];
}

async function createDefaultUsers(db) {
  const existingUsernames = new Set(
    (await db.all("SELECT username FROM users")).map((row) => row.username)
  );

  for (const user of DEFAULT_USERS) {
    if (existingUsernames.has(user.username)) {
      continue;
    }

    await db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [user.username, bcrypt.hashSync(user.password, 10)]
    );
  }
}

function createSqliteAdapter(sqlite, dbPath) {
  return {
    provider: "sqlite",
    dialect: "sqlite",
    dbPath,

    async exec(sql) {
      sqlite.exec(sql);
    },

    async get(sql, params = []) {
      return sqlite.prepare(sql).get(...params) || null;
    },

    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },

    async run(sql, params = []) {
      const result = sqlite.prepare(sql).run(...params);
      return {
        changes: Number(result.changes || 0),
        lastInsertRowid:
          result.lastInsertRowid == null ? null : Number(result.lastInsertRowid),
        rows: [],
      };
    },

    async listTables() {
      const rows = sqlite
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table'
             AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .all();
      return rows.map((row) => row.name);
    },

    async clearTables(tableNames) {
      sqlite.exec("PRAGMA foreign_keys = OFF");
      try {
        for (const tableName of tableNames) {
          sqlite.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();
        }

        const sequenceTable = sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
          )
          .get();
        if (sequenceTable) {
          sqlite.prepare("DELETE FROM sqlite_sequence").run();
        }
      } finally {
        sqlite.exec("PRAGMA foreign_keys = ON");
      }
    },

    normalizeBoolean(value) {
      return value ? 1 : 0;
    },

    coerceRowValue(type, value) {
      if (type === "boolean" && value != null) {
        return Boolean(value);
      }
      return value;
    },

    isConstraintError(err) {
      return Boolean(
        err &&
          typeof err.code === "string" &&
          err.code.startsWith("SQLITE_") &&
          err.code !== "SQLITE_BUSY" &&
          err.code !== "SQLITE_LOCKED"
      );
    },

    async close() {
      sqlite.close();
    },
  };
}

function createPostgresAdapter(pool) {
  return {
    provider: "postgres",
    dialect: "postgres",

    async exec(sql) {
      await pool.query(sql);
    },

    async get(sql, params = []) {
      const result = await pool.query(convertPostgresParams(sql), params);
      return result.rows[0] || null;
    },

    async all(sql, params = []) {
      const result = await pool.query(convertPostgresParams(sql), params);
      return result.rows;
    },

    async run(sql, params = []) {
      const text = convertPostgresParams(sql);
      const normalizedSql = /\breturning\b/i.test(text) ? text : `${text} RETURNING id`;
      const result = await pool.query(normalizedSql, params);
      return {
        changes: Number(result.rowCount || 0),
        lastInsertRowid: result.rows[0]?.id == null ? null : Number(result.rows[0].id),
        rows: result.rows,
      };
    },

    async listTables() {
      const result = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );
      return result.rows.map((row) => row.table_name);
    },

    async clearTables(tableNames) {
      if (tableNames.length === 0) {
        return;
      }
      const quoted = tableNames.map((tableName) => quoteIdentifier(tableName)).join(", ");
      await pool.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
    },

    normalizeBoolean(value) {
      return Boolean(value);
    },

    coerceRowValue(type, value) {
      if (type === "boolean" && value != null) {
        return Boolean(value);
      }
      return value;
    },

    isConstraintError(err) {
      return Boolean(err && typeof err.code === "string" && err.code.startsWith("23"));
    },

    async close() {
      await pool.end();
    },
  };
}

function convertPostgresParams(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

module.exports = {
  createDefaultUsers,
  getDatabasePath,
  initDatabase,
  recreateDatabase,
  resolveDatabaseProvider,
};
