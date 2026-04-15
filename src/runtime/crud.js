const express = require("express");
const { optionalAuth, requireAuth } = require("./auth");

function registerGeneratedResources(app, db, resources) {
  const resourceMap = new Map(resources.map((resource) => [resource.name, resource]));
  for (const resource of resources) {
    app.use(resource.path, buildCrudRouter(db, resource, resourceMap));
  }
}

function buildCrudRouter(db, resource, resourceMap) {
  const router = express.Router();

  if (resource.operations.includes("list")) {
    router.get("/", optionalAuth, (req, res) => {
      if (!ensureCollectionPolicy(resource.permissions.list, req, res)) {
        return;
      }

      const rows = listRows(db, resource, req.user);
      const payload = rows.map((row) => shapeRecord(db, resourceMap, resource, row));
      res.json(payload);
    });
  }

  if (resource.operations.includes("retrieve")) {
    router.get("/:id", optionalAuth, (req, res) => {
      const row = getAccessibleRow(db, resource, req.params.id, req.user, resource.permissions.retrieve);
      if (row === null) {
        res.status(404).json({ error: "Record not found." });
        return;
      }
      if (row === false) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      res.json(shapeRecord(db, resourceMap, resource, row));
    });
  }

  if (resource.operations.includes("create")) {
    router.post("/", requirePolicyMiddleware(resource.permissions.create), (req, res, next) => {
      const validationError = validateBody(resource, req.body, false);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const body = sanitizeBody(resource, req.body);
      const fieldNames = resource.fields.map((field) => field.name);
      const values = fieldNames.map((fieldName) => body[fieldName] ?? null);

      if (resource.ownershipEnabled) {
        fieldNames.unshift("owner_id");
        values.unshift(req.user.sub);
      }

      const placeholders = fieldNames.map(() => "?").join(", ");
      let result;
      try {
        result = db
          .prepare(
            `INSERT INTO ${resource.tableName} (${fieldNames.join(", ")}) VALUES (${placeholders})`
          )
          .run(...values);
      } catch (err) {
        if (isSqliteConstraintError(err)) {
          res.status(400).json({ error: err.message });
          return;
        }
        return next(err);
      }

      const created = db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ?`)
        .get(result.lastInsertRowid);

      try {
        res
          .status(201)
          .json(shapeRecord(db, resourceMap, resource, created));
      } catch (err) {
        next(err);
      }
    });
  }

  if (resource.operations.includes("update")) {
    router.patch("/:id", requirePolicyMiddleware(resource.permissions.update), (req, res) => {
      const existing = getAccessibleRow(db, resource, req.params.id, req.user, resource.permissions.update);
      if (!existing) {
        res.status(existing === false ? 401 : 404).json({
          error: existing === false ? "Authentication required." : "Record not found.",
        });
        return;
      }

      const validationError = validateBody(resource, req.body, true);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const body = sanitizeBody(resource, req.body, true);
      const fieldNames = Object.keys(body);
      if (fieldNames.length === 0) {
        res.status(400).json({ error: "No updatable fields were provided." });
        return;
      }

      const assignments = fieldNames.map((fieldName) => `${fieldName} = ?`).join(", ");
      const values = fieldNames.map((fieldName) => body[fieldName]);

      db.prepare(`UPDATE ${resource.tableName} SET ${assignments} WHERE id = ?`).run(
        ...values,
        req.params.id
      );

      const updated = db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ?`)
        .get(req.params.id);

      res.json(shapeRecord(db, resourceMap, resource, updated));
    });
  }

  if (resource.operations.includes("delete")) {
    router.delete("/:id", requirePolicyMiddleware(resource.permissions.delete), (req, res) => {
      const existing = getAccessibleRow(db, resource, req.params.id, req.user, resource.permissions.delete);
      if (!existing) {
        res.status(existing === false ? 401 : 404).json({
          error: existing === false ? "Authentication required." : "Record not found.",
        });
        return;
      }

      db.prepare(`DELETE FROM ${resource.tableName} WHERE id = ?`).run(req.params.id);
      db.prepare("DELETE FROM shares WHERE resource_type = ? AND resource_id = ?").run(
        resource.name,
        req.params.id
      );

      res.status(204).send();
    });
  }

  if (resource.shareable) {
    router.get("/:id/shares", requireAuth, (req, res) => {
      const owned = db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ? AND owner_id = ?`)
        .get(req.params.id, req.user.sub);
      if (!owned) {
        res.status(404).json({ error: "Record not found." });
        return;
      }

      const shares = db
        .prepare(
          `SELECT s.id, s.shared_with_user_id, u.username, s.created_at
           FROM shares s
           JOIN users u ON u.id = s.shared_with_user_id
           WHERE s.resource_type = ? AND s.resource_id = ?
           ORDER BY u.username`
        )
        .all(resource.name, req.params.id);

      res.json(shares);
    });

    router.post("/:id/shares", requireAuth, (req, res) => {
      const owned = db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ? AND owner_id = ?`)
        .get(req.params.id, req.user.sub);
      if (!owned) {
        res.status(404).json({ error: "Record not found." });
        return;
      }

      const username = String(req.body?.username || "").trim();
      const userId = req.body?.user_id;
      if (!username && !userId) {
        res.status(400).json({ error: "Provide `username` or `user_id` to share a record." });
        return;
      }

      const targetUser = username
        ? db.prepare("SELECT id, username FROM users WHERE username = ?").get(username)
        : db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);

      if (!targetUser) {
        res.status(404).json({ error: "Target user not found." });
        return;
      }
      if (targetUser.id === req.user.sub) {
        res.status(400).json({ error: "Owners already have access to their own records." });
        return;
      }

      const result = db
        .prepare(
          `INSERT OR IGNORE INTO shares
             (resource_type, resource_id, shared_with_user_id, shared_by_user_id)
           VALUES (?, ?, ?, ?)`
        )
        .run(resource.name, req.params.id, targetUser.id, req.user.sub);

      if (result.changes === 0) {
        res.status(200).json({
          message: "That user already has access.",
          user: targetUser,
        });
        return;
      }

      const share = db
        .prepare(
          `SELECT id, resource_type, resource_id, shared_with_user_id, shared_by_user_id, created_at
           FROM shares
           WHERE resource_type = ? AND resource_id = ? AND shared_with_user_id = ?`
        )
        .get(resource.name, req.params.id, targetUser.id);

      res.status(201).json({
        ...share,
        username: targetUser.username,
      });
    });

    router.delete("/:id/shares/:shareId", requireAuth, (req, res) => {
      const owned = db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ? AND owner_id = ?`)
        .get(req.params.id, req.user.sub);
      if (!owned) {
        res.status(404).json({ error: "Record not found." });
        return;
      }

      const result = db
        .prepare(
          "DELETE FROM shares WHERE id = ? AND resource_type = ? AND resource_id = ?"
        )
        .run(req.params.shareId, resource.name, req.params.id);

      if (result.changes === 0) {
        res.status(404).json({ error: "Share not found." });
        return;
      }

      res.status(204).send();
    });
  }

  return router;
}

function listRows(db, resource, user) {
  const baseQuery = `SELECT DISTINCT t.* FROM ${resource.tableName} t`;
  switch (resource.permissions.list) {
    case "public":
      return db.prepare(`SELECT * FROM ${resource.tableName} ORDER BY id DESC`).all();
    case "user":
      return db.prepare(`SELECT * FROM ${resource.tableName} ORDER BY id DESC`).all();
    case "owner":
      return db
        .prepare(`SELECT * FROM ${resource.tableName} WHERE owner_id = ? ORDER BY id DESC`)
        .all(user.sub);
    case "owner_or_shared":
      return db
        .prepare(
          `${baseQuery}
           LEFT JOIN shares s
             ON s.resource_type = ?
            AND s.resource_id = t.id
            AND s.shared_with_user_id = ?
           WHERE t.owner_id = ? OR s.shared_with_user_id = ?
           ORDER BY t.id DESC`
        )
        .all(resource.name, user.sub, user.sub, user.sub);
    default:
      return [];
  }
}

function getAccessibleRow(db, resource, id, user, policy) {
  switch (policy) {
    case "public":
      return db.prepare(`SELECT * FROM ${resource.tableName} WHERE id = ?`).get(id) || null;
    case "user":
      return user
        ? db.prepare(`SELECT * FROM ${resource.tableName} WHERE id = ?`).get(id) || null
        : false;
    case "owner":
      return user
        ? db
            .prepare(`SELECT * FROM ${resource.tableName} WHERE id = ? AND owner_id = ?`)
            .get(id, user.sub) || null
        : false;
    case "owner_or_shared":
      if (!user) {
        return false;
      }
      return (
        db
          .prepare(
            `SELECT DISTINCT t.*
             FROM ${resource.tableName} t
             LEFT JOIN shares s
               ON s.resource_type = ?
              AND s.resource_id = t.id
              AND s.shared_with_user_id = ?
             WHERE t.id = ? AND (t.owner_id = ? OR s.shared_with_user_id = ?)`
          )
          .get(resource.name, user.sub, id, user.sub, user.sub) || null
      );
    default:
      return null;
  }
}

function shapeRecord(db, resourceMap, resource, record, depth = 0) {
  if (!record) {
    return null;
  }

  const creator = getCreatorUsername(db, resource, record);
  const shaped = creator ? { ...record, creator } : { ...record };

  if (depth > 0) {
    return shaped;
  }

  for (const relation of resource.relations || []) {
    if (!relation || relation.kind !== "belongsTo") {
      continue;
    }

    const target = resourceMap.get(relation.targetResource);
    if (!target) {
      continue;
    }

    const foreignValue = record[relation.localField];
    if (foreignValue == null) {
      shaped[relation.name] = null;
      continue;
    }

    const relatedRecord = db
      .prepare(`SELECT * FROM ${target.tableName} WHERE ${relation.targetField || "id"} = ?`)
      .get(foreignValue);

    shaped[relation.name] = shapeRecord(db, resourceMap, target, relatedRecord, depth + 1);
  }

  return shaped;
}

function getCreatorUsername(db, resource, record) {
  if (!resource.ownershipEnabled || record.owner_id == null) {
    return null;
  }

  const owner = db.prepare("SELECT username FROM users WHERE id = ?").get(record.owner_id);
  return owner?.username || null;
}

function validateBody(resource, body, partial) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  const allowedFields = new Set(resource.fields.map((field) => field.name));
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      return `Unknown field: ${key}`;
    }
  }

  for (const field of resource.fields) {
    const value = body[field.name];
    if (!partial && field.required && (value === undefined || value === null || value === "")) {
      return `Field \`${field.name}\` is required.`;
    }
    if (value !== undefined && value !== null && !isValidType(field.type, value)) {
      return `Field \`${field.name}\` must be of type \`${field.type}\`.`;
    }
  }

  return null;
}

function sanitizeBody(resource, body, partial = false) {
  const clean = {};
  for (const field of resource.fields) {
    if (Object.prototype.hasOwnProperty.call(body, field.name)) {
      clean[field.name] = normalizeValue(field.type, body[field.name]);
    } else if (!partial) {
      clean[field.name] = null;
    }
  }
  return clean;
}

function normalizeValue(type, value) {
  if (value == null) {
    return null;
  }
  if (type === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}

function isValidType(type, value) {
  switch (type) {
    case "string":
    case "text":
    case "date":
    case "datetime":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function requirePolicyMiddleware(policy) {
  if (policy === "public") {
    return (_req, _res, next) => next();
  }
  return requireAuth;
}

/** better-sqlite3 throws SqliteError with code SQLITE_* */
function isSqliteConstraintError(err) {
  return Boolean(
    err &&
      typeof err.code === "string" &&
      err.code.startsWith("SQLITE_") &&
      err.code !== "SQLITE_BUSY" &&
      err.code !== "SQLITE_LOCKED"
  );
}

function ensureCollectionPolicy(policy, req, res) {
  if (policy === "public") {
    return true;
  }
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }
  return true;
}

module.exports = {
  registerGeneratedResources,
};
