const fs = require("fs");
const path = require("path");
const { writeSeedArtifacts } = require("./seedArtifacts");
const { normalizeSeedDir } = require("../runtime/seedDir");

function writeArtifacts(projectRoot, config, seedOptions = {}) {
  const seedDir = normalizeSeedDir(seedOptions.seedDir, config.meta?.seedDir || "data");
  const configWithMeta = {
    ...config,
    meta: {
      ...config.meta,
      seedDir,
    },
  };
  const generatedDir = path.join(projectRoot, "generated");
  const routesDir = path.join(generatedDir, "routes");
  const validatorsDir = path.join(generatedDir, "validators");
  const docsDir = path.join(generatedDir, "docs");

  fs.mkdirSync(routesDir, { recursive: true });
  fs.mkdirSync(validatorsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(
    path.join(generatedDir, "config.json"),
    JSON.stringify(configWithMeta, null, 2)
  );

  const publicDir = path.join(projectRoot, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(
    path.join(publicDir, "generated-config.json"),
    JSON.stringify(configWithMeta, null, 2)
  );

  fs.writeFileSync(path.join(generatedDir, "schema.sql"), buildSchemaSql(configWithMeta));
  fs.writeFileSync(
    path.join(docsDir, "routes.json"),
    JSON.stringify(buildDocs(configWithMeta), null, 2)
  );
  fs.writeFileSync(
    path.join(docsDir, "openapi.json"),
    JSON.stringify(buildOpenApi(configWithMeta), null, 2)
  );

  const routeModules = [];
  for (const resource of configWithMeta.resources) {
    const validatorModulePath = `../validators/${resource.fileBase}.js`;
    const routeModulePath = path.join(routesDir, `${resource.fileBase}.js`);
    const validatorModule = buildValidatorModule(resource);
    const routeModule = buildRouteModule(resource, validatorModulePath);

    fs.writeFileSync(
      path.join(validatorsDir, `${resource.fileBase}.js`),
      validatorModule
    );
    fs.writeFileSync(routeModulePath, routeModule);
    routeModules.push(resource.fileBase);
  }

  fs.writeFileSync(
    path.join(routesDir, "index.js"),
    [
      ...routeModules.map(
        (moduleName) => `const ${toIdentifier(moduleName)} = require("./${moduleName}");`
      ),
      "",
      "module.exports = [",
      ...routeModules.map((moduleName) => `  ${toIdentifier(moduleName)},`),
      "];",
      "",
    ].join("\n")
  );

  writeSeedArtifacts(projectRoot, configWithMeta, {
    ...seedOptions,
    seedDir,
  });
}

function buildSchemaSql(config) {
  return config.resources
    .map((resource) => {
      const columnLines = ["id INTEGER PRIMARY KEY AUTOINCREMENT"];
      if (resource.ownershipEnabled) {
        columnLines.push("owner_id INTEGER NOT NULL");
      }

      for (const field of resource.fields) {
        const required = field.required ? " NOT NULL" : "";
        columnLines.push(`${field.name} ${sqlTypeForField(field.type)}${required}`);
      }

      if (resource.ownershipEnabled) {
        columnLines.push("FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE");
      }

      for (const field of resource.fields) {
        if (field.references) {
          columnLines.push(
            `FOREIGN KEY (${field.name}) REFERENCES ${field.references.resource}(${field.references.field || "id"})`
          );
        }
      }

      return [
        `CREATE TABLE IF NOT EXISTS ${resource.tableName} (`,
        `  ${columnLines.join(",\n  ")}`,
        ");",
        "",
      ].join("\n");
    })
    .join("\n");
}

function buildDocs(config) {
  return {
    generatedAt: config.meta.generatedAt,
    builtIns: {
      auth: [
        { method: "POST", path: "/auth/register" },
        { method: "POST", path: "/auth/login" },
        { method: "GET", path: "/auth/me" },
      ],
    },
    resources: config.resources.map((resource) => {
      const endpoints = [];
      if (resource.operations.includes("list")) {
        endpoints.push({
          method: "GET",
          path: resource.path,
          permissions: resource.permissions.list,
        });
      }
      if (resource.operations.includes("retrieve")) {
        endpoints.push({
          method: "GET",
          path: `${resource.path}/:id`,
          permissions: resource.permissions.retrieve,
        });
      }
      if (resource.operations.includes("create")) {
        endpoints.push({
          method: "POST",
          path: resource.path,
          permissions: resource.permissions.create,
        });
      }
      if (resource.operations.includes("update")) {
        endpoints.push({
          method: "PATCH",
          path: `${resource.path}/:id`,
          permissions: resource.permissions.update,
        });
      }
      if (resource.operations.includes("delete")) {
        endpoints.push({
          method: "DELETE",
          path: `${resource.path}/:id`,
          permissions: resource.permissions.delete,
        });
      }
      if (resource.shareable) {
        endpoints.push(
          { method: "GET", path: `${resource.path}/:id/shares`, permissions: "owner" },
          { method: "POST", path: `${resource.path}/:id/shares`, permissions: "owner" },
          { method: "DELETE", path: `${resource.path}/:id/shares/:shareId`, permissions: "owner" }
        );
      }
      return {
        name: resource.name,
        path: resource.path,
        shareable: resource.shareable,
        endpoints,
      };
    }),
  };
}

function buildOpenApi(config) {
  const resourceMap = new Map(config.resources.map((resource) => [resource.name, resource]));
  const paths = {
    "/auth/register": {
      post: {
        tags: ["auth"],
        summary: "Register a new user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Registered successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Log in and receive a bearer token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Logged in successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["auth"],
        summary: "Fetch the current user",
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "Current user",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentUser" },
              },
            },
          },
        },
      },
    },
  };

  const components = {
    schemas: {
      AuthUser: {
        type: "object",
        properties: {
          id: { type: "integer" },
          username: { type: "string" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" },
          token: { type: "string" },
        },
      },
      CurrentUser: {
        type: "object",
        properties: {
          id: { type: "integer" },
          username: { type: "string" },
          created_at: { type: "string" },
        },
      },
      ShareRequest: {
        type: "object",
        properties: {
          username: { type: "string" },
          user_id: { type: "integer" },
        },
      },
      ShareRecord: {
        type: "object",
        properties: {
          id: { type: "integer" },
          resource_type: { type: "string" },
          resource_id: { type: "integer" },
          shared_with_user_id: { type: "integer" },
          shared_by_user_id: { type: "integer" },
          created_at: { type: "string" },
          username: { type: "string" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  };

  for (const resource of config.resources) {
    const createSchemaName = `${pascalCase(resource.name)}CreateInput`;
    const updateSchemaName = `${pascalCase(resource.name)}UpdateInput`;
    const fullSchemaName = `${pascalCase(resource.name)}Record`;

    components.schemas[createSchemaName] = buildInputSchema(resource, false);
    components.schemas[updateSchemaName] = buildInputSchema(resource, true);
    components.schemas[fullSchemaName] = buildFullRecordSchema(resourceMap, resource);

    if (resource.operations.includes("list")) {
      paths[resource.path] ||= {};
      paths[resource.path].get = {
        tags: [resource.name],
        summary: `List ${resource.name}`,
        responses: {
          200: {
            description: "List of records",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: `#/components/schemas/${fullSchemaName}` },
                },
              },
            },
          },
          ...errorResponses(),
        },
        ...securityForPolicy(resource.permissions.list),
      };
    }

    if (resource.operations.includes("create")) {
      paths[resource.path] ||= {};
      paths[resource.path].post = {
        tags: [resource.name],
        summary: `Create a ${resource.name} record`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${createSchemaName}` },
            },
          },
        },
        responses: {
          201: {
            description: "Created successfully",
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${fullSchemaName}` },
              },
            },
          },
          ...errorResponses(),
        },
        ...securityForPolicy(resource.permissions.create),
      };
    }

    const detailPath = `${resource.path}/{id}`;
    if (resource.operations.includes("retrieve")) {
      paths[detailPath] ||= { parameters: [idParameter()] };
      paths[detailPath].get = {
        tags: [resource.name],
        summary: `Fetch one ${resource.name} record`,
        responses: {
          200: {
            description: "Record found",
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${fullSchemaName}` },
              },
            },
          },
          ...errorResponses(),
        },
        ...securityForPolicy(resource.permissions.retrieve),
      };
    }

    if (resource.operations.includes("update")) {
      paths[detailPath] ||= { parameters: [idParameter()] };
      paths[detailPath].patch = {
        tags: [resource.name],
        summary: `Update one ${resource.name} record`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${updateSchemaName}` },
            },
          },
        },
        responses: {
          200: {
            description: "Updated successfully",
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${fullSchemaName}` },
              },
            },
          },
          ...errorResponses(),
        },
        ...securityForPolicy(resource.permissions.update),
      };
    }

    if (resource.operations.includes("delete")) {
      paths[detailPath] ||= { parameters: [idParameter()] };
      paths[detailPath].delete = {
        tags: [resource.name],
        summary: `Delete one ${resource.name} record`,
        responses: {
          204: { description: "Deleted successfully" },
          ...errorResponses(),
        },
        ...securityForPolicy(resource.permissions.delete),
      };
    }

    if (resource.shareable) {
      const sharePath = `${resource.path}/{id}/shares`;
      const deleteSharePath = `${resource.path}/{id}/shares/{shareId}`;

      paths[sharePath] = {
        parameters: [idParameter()],
        get: {
          tags: [resource.name],
          summary: `List shares for a ${resource.name} record`,
          security: [{ BearerAuth: [] }],
          responses: {
            200: {
              description: "Shares",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ShareRecord" },
                  },
                },
              },
            },
            ...errorResponses(),
          },
        },
        post: {
          tags: [resource.name],
          summary: `Share a ${resource.name} record with another user`,
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShareRequest" },
              },
            },
          },
          responses: {
            201: {
              description: "Shared successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ShareRecord" },
                },
              },
            },
            ...errorResponses(),
          },
        },
      };

      paths[deleteSharePath] = {
        parameters: [
          idParameter(),
          {
            in: "path",
            name: "shareId",
            required: true,
            schema: { type: "integer" },
          },
        ],
        delete: {
          tags: [resource.name],
          summary: `Remove a share from a ${resource.name} record`,
          security: [{ BearerAuth: [] }],
          responses: {
            204: { description: "Share removed" },
            ...errorResponses(),
          },
        },
      };
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "API Generator Starter API",
      version: "1.0.0",
      description:
        "Interactive API documentation generated from api.config.yaml and the built-in auth/sharing system.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "auth" },
      ...config.resources.map((resource) => ({ name: resource.name })),
    ],
    components,
    paths,
  };
}

function buildValidatorModule(resource) {
  return [
    `module.exports = ${JSON.stringify(
      {
        resource: resource.name,
        fields: resource.fields,
      },
      null,
      2
    )};`,
    "",
  ].join("\n");
}

function buildRouteModule(resource, validatorModulePath) {
  return [
    `const validator = require("${validatorModulePath}");`,
    "",
    `module.exports = ${JSON.stringify(resource, null, 2)};`,
    "module.exports.validator = validator;",
    "",
  ].join("\n");
}

function sqlTypeForField(type) {
  switch (type) {
    case "integer":
      return "INTEGER";
    case "number":
      return "REAL";
    case "boolean":
      return "INTEGER";
    case "date":
    case "datetime":
    case "string":
    case "text":
    default:
      return "TEXT";
  }
}

function buildInputSchema(resource, partial) {
  const required = partial
    ? []
    : resource.fields.filter((field) => field.required).map((field) => field.name);

  return {
    type: "object",
    ...(required.length > 0 ? { required } : {}),
    properties: Object.fromEntries(
      resource.fields.map((field) => [field.name, openApiTypeForField(field.type)])
    ),
  };
}

function buildFullRecordSchema(resourceMap, resource, depth = 0) {
  const properties = {
    id: { type: "integer" },
  };

  if (resource.ownershipEnabled) {
    properties.owner_id = { type: "integer" };
    properties.creator = { type: "string" };
  }

  for (const field of resource.fields) {
    properties[field.name] = openApiTypeForField(field.type);
  }

  if (depth === 0) {
    for (const relation of resource.relations || []) {
      if (relation.kind !== "belongsTo") {
        continue;
      }

      const target = resourceMap.get(relation.targetResource);
      if (!target) {
        continue;
      }

      properties[relation.name] = {
        ...buildFullRecordSchema(resourceMap, target, depth + 1),
        nullable: true,
      };
    }
  }

  return {
    type: "object",
    properties,
  };
}

function openApiTypeForField(type) {
  switch (type) {
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "text":
    case "string":
    default:
      return { type: "string" };
  }
}

function pascalCase(value) {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function securityForPolicy(policy) {
  return policy === "public" ? {} : { security: [{ BearerAuth: [] }] };
}

function idParameter() {
  return {
    in: "path",
    name: "id",
    required: true,
    schema: { type: "integer" },
  };
}

function errorResponses() {
  return {
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    },
    401: {
      description: "Authentication required or token invalid",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    },
    404: {
      description: "Resource not found",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    },
  };
}

function toIdentifier(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase()).replace(/[^a-zA-Z0-9_$]/g, "");
}

module.exports = {
  writeArtifacts,
};
