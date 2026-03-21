const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const { initDatabase } = require("./runtime/db");
const { registerAuthRoutes } = require("./runtime/auth");
const { registerGeneratedResources } = require("./runtime/crud");

function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const generatedConfigPath = path.join(projectRoot, "generated", "config.json");
  const generatedDocsPath = path.join(projectRoot, "generated", "docs", "routes.json");
  const generatedOpenApiPath = path.join(projectRoot, "generated", "docs", "openapi.json");
  const generatedRoutesPath = path.join(projectRoot, "generated", "routes", "index.js");

  if (!fs.existsSync(generatedConfigPath)) {
    console.error("Missing generated/config.json. Run `npm run generate` first.");
    process.exit(1);
  }
  if (!fs.existsSync(generatedRoutesPath)) {
    console.error("Missing generated/routes/index.js. Run `npm run generate` first.");
    process.exit(1);
  }

  const generatedConfig = JSON.parse(fs.readFileSync(generatedConfigPath, "utf8"));
  const docs = fs.existsSync(generatedDocsPath)
    ? JSON.parse(fs.readFileSync(generatedDocsPath, "utf8"))
    : null;
  const openApi = fs.existsSync(generatedOpenApiPath)
    ? JSON.parse(fs.readFileSync(generatedOpenApiPath, "utf8"))
    : null;
  const generatedResources = require(generatedRoutesPath);

  const db = initDatabase(projectRoot);
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(projectRoot, "public")));

  app.get("/", (_req, res) => {
    res.type("html").send(renderHomePage(generatedConfig));
  });

  app.get("/api/docs.json", (_req, res) => {
    res.json(docs);
  });
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApi);
  });
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApi, {
      explorer: true,
      swaggerOptions: {
        persistAuthorization: true,
      },
      customSiteTitle: "API Generator Docs",
    })
  );

  registerAuthRoutes(app, db);
  registerGeneratedResources(app, db, generatedResources);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Unexpected server error." });
  });

  const port = Number(process.env.PORT || 3100);
  app.listen(port, () => {
    console.log(`API generator starter app listening on http://localhost:${port}`);
  });
}

function renderHomePage(generatedConfig) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>API Generator Starter</title>
      <link rel="stylesheet" href="/styles/home.css" />
      <script>
        (() => {
          try {
            const storedTheme = localStorage.getItem("api-generator-theme");
            const theme = storedTheme === "dark" ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", theme);
          } catch (_error) {
            document.documentElement.setAttribute("data-theme", "light");
          }
        })();
      </script>
    </head>
    <body>
      <main class="shell">
        <section class="hero">
          <div class="hero-card">
            <div class="hero-header">
              <div class="eyebrow">Sarah's Declarative CRUD Starter App</div>
              <button class="theme-toggle" id="theme-toggle" type="button" aria-pressed="false">
                <span id="theme-toggle-icon">Dark</span>
                <span id="theme-toggle-label">mode</span>
              </button>
            </div>
            <h1>Build an API from one YAML file.</h1>
            <p class="lede">
              This starter app reads <code>api.config.yaml</code>, generates your routes, schema, docs,
              and validators, and serves a working API with built-in auth and sharing support.
            </p>
            <div class="actions">
              <a class="button primary" href="/api/docs">Open Interactive Docs</a>
              <a class="button secondary" href="/api/openapi.json">View OpenAPI JSON</a>
              <a class="button secondary" href="/api/docs.json">View Route Summary</a>
            </div>
            <div class="hero-meta">
              <span>Generated from <strong>${escapeHtml(generatedConfig.meta.configPath)}</strong></span>
              <span>${generatedConfig.resources.length} resource${generatedConfig.resources.length === 1 ? "" : "s"}</span>
              <span>Built-in auth + global shares table</span>
            </div>
          </div>

          <aside class="hero-side hero-card">
            <div>
              <h2>Quick Start</h2>
              <ol>
                <li>Edit <code>api.config.yaml</code></li>
                <li>Run <code>npm run validate</code></li>
                <li>Run <code>npm run generate</code></li>
                <li>Run <code>npm start</code></li>
                <li>Test requests in <code>/api/docs</code></li>
              </ol>
            </div>
            <div class="warning">
              <strong>Important:</strong> running <code>npm run generate</code> recreates the local
              SQLite database from scratch based on the latest schema.
            </div>
          </aside>
        </section>
      </main>
      <script>
        (() => {
          const root = document.documentElement;
          const button = document.getElementById("theme-toggle");
          const icon = document.getElementById("theme-toggle-icon");
          const label = document.getElementById("theme-toggle-label");

          if (!button || !icon || !label) {
            return;
          }

          const syncButton = () => {
            const isDark = root.getAttribute("data-theme") === "dark";
            button.setAttribute("aria-pressed", String(isDark));
            icon.textContent = isDark ? "Light" : "Dark";
            label.textContent = "mode";
          };

          button.addEventListener("click", () => {
            const nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", nextTheme);
            try {
              localStorage.setItem("api-generator-theme", nextTheme);
            } catch (_error) {}
            syncButton();
          });

          syncButton();
        })();
      </script>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

main();
