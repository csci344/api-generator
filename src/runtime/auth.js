const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret";

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function optionalAuth(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) {
    req.user = null;
    next();
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_error) {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

function registerAuthRoutes(app, db) {
  app.post("/auth/register", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      res.status(400).json({ error: "username and password are required." });
      return;
    }

    const existing = await db.get("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash]
    );

    const user = { id: result.lastInsertRowid, username };
    res.status(201).json({
      user,
      token: issueToken(user),
    });
  });

  app.post("/auth/login", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }

    res.json({
      user: { id: user.id, username: user.username },
      token: issueToken(user),
    });
  });

  app.get("/auth/me", requireAuth, async (req, res) => {
    const user = await db.get("SELECT id, username, created_at FROM users WHERE id = ?", [
      req.user.sub,
    ]);
    res.json(user);
  });

  app.get("/auth/users", requireAuth, async (_req, res) => {
    const users = await db.all(
      "SELECT id, username, created_at FROM users ORDER BY username ASC"
    );
    res.json(users);
  });
}

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

module.exports = {
  issueToken,
  optionalAuth,
  requireAuth,
  registerAuthRoutes,
};
