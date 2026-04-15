const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ALLOWED_TYPES = new Set([
  "string",
  "text",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
]);

const ALLOWED_OPERATIONS = new Set([
  "list",
  "retrieve",
  "create",
  "update",
  "delete",
]);

const ALLOWED_POLICIES = new Set([
  "public",
  "user",
  "owner",
  "owner_or_shared",
]);

function loadApiConfig(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  const document = YAML.parseDocument(raw);
  if (document.errors.length > 0) {
    throw new Error(document.errors[0].message);
  }
  const parsed = document.toJSON();
  return normalizeConfig(parsed ?? {}, configPath);
}

function normalizeConfig(config, configPath) {
  if (!Array.isArray(config.resources) || config.resources.length === 0) {
    throw new Error("`api.config.yaml` must define a non-empty `resources` array.");
  }

  const seenNames = new Set();
  const seenPaths = new Set();

  const normalizedResources = config.resources.map((resource) => {
    if (!resource?.name) {
      throw new Error("Each resource must have a `name`.");
    }

    if (seenNames.has(resource.name)) {
      throw new Error(`Duplicate resource name: ${resource.name}`);
    }
    seenNames.add(resource.name);

    const pathValue = resource.path || `/api/${toKebabCase(resource.name)}`;
    if (seenPaths.has(pathValue)) {
      throw new Error(`Duplicate resource path: ${pathValue}`);
    }
    seenPaths.add(pathValue);

    const operations = Array.isArray(resource.operations) && resource.operations.length > 0
      ? resource.operations
      : ["list", "retrieve", "create", "update", "delete"];

    for (const operation of operations) {
      if (!ALLOWED_OPERATIONS.has(operation)) {
        throw new Error(`Unsupported operation \`${operation}\` in resource \`${resource.name}\`.`);
      }
    }

    if (!Array.isArray(resource.fields) || resource.fields.length === 0) {
      throw new Error(`Resource \`${resource.name}\` must define at least one field.`);
    }

    const seenFieldNames = new Set();
    const fields = resource.fields.map((field) => {
      if (!field?.name || !field?.type) {
        throw new Error(`Every field in resource \`${resource.name}\` needs \`name\` and \`type\`.`);
      }
      if (field.name === "id" || field.name === "owner_id") {
        throw new Error(`Field name \`${field.name}\` is reserved in resource \`${resource.name}\`.`);
      }
      if (seenFieldNames.has(field.name)) {
        throw new Error(`Duplicate field \`${field.name}\` in resource \`${resource.name}\`.`);
      }
      seenFieldNames.add(field.name);

      if (!ALLOWED_TYPES.has(field.type)) {
        throw new Error(
          `Unsupported field type \`${field.type}\` in resource \`${resource.name}\`.`
        );
      }

      return {
        name: field.name,
        type: field.type,
        required: Boolean(field.required),
        references: field.references || null,
      };
    });

    const permissions = {
      list: resource.permissions?.list || resource.auth?.list || "public",
      retrieve: resource.permissions?.retrieve || resource.auth?.retrieve || "public",
      create: resource.permissions?.create || resource.auth?.create || "user",
      update: resource.permissions?.update || resource.auth?.update || "owner",
      delete: resource.permissions?.delete || resource.auth?.delete || "owner",
    };

    for (const [operation, policy] of Object.entries(permissions)) {
      if (!ALLOWED_POLICIES.has(policy)) {
        throw new Error(
          `Unsupported permissions policy \`${policy}\` on ${resource.name}.${operation}.`
        );
      }
    }

    const enabledPolicies = operations.map((operation) => permissions[operation]);
    const ownershipEnabled = enabledPolicies.some((policy) =>
      ["user", "owner", "owner_or_shared"].includes(policy)
    );

    if (
      operations.includes("create") &&
      (permissions.update === "owner" ||
        permissions.delete === "owner" ||
        permissions.list === "owner" ||
        permissions.retrieve === "owner" ||
        permissions.list === "owner_or_shared" ||
        permissions.retrieve === "owner_or_shared") &&
      permissions.create === "public"
    ) {
      throw new Error(
        `Resource \`${resource.name}\` cannot use owner-based rules if \`create\` is public.`
      );
    }

    if (
      !resource.shareable &&
      (permissions.list === "owner_or_shared" || permissions.retrieve === "owner_or_shared")
    ) {
      throw new Error(
        `Resource \`${resource.name}\` uses \`owner_or_shared\` but is not marked \`shareable: true\`.`
      );
    }

    return {
      name: resource.name,
      tableName: resource.name,
      fileBase: toKebabCase(resource.name),
      path: pathValue,
      operations,
      shareable: Boolean(resource.shareable),
      ownershipEnabled,
      fields,
      relations: normalizeRelations(resource),
      permissions,
    };
  });

  const resourceMap = new Map(normalizedResources.map((resource) => [resource.name, resource]));

  for (const resource of normalizedResources) {
    for (const field of resource.fields) {
      if (field.references) {
        const target = resourceMap.get(field.references.resource);
        if (!target) {
          throw new Error(
            `Field \`${resource.name}.${field.name}\` references missing resource \`${field.references.resource}\`.`
          );
        }
        const targetField = field.references.field || "id";
        if (targetField !== "id" && !target.fields.some((candidate) => candidate.name === targetField)) {
          throw new Error(
            `Field \`${resource.name}.${field.name}\` references missing field \`${targetField}\` on \`${target.name}\`.`
          );
        }
      }
    }

    for (const relation of resource.relations) {
      if (relation.kind !== "belongsTo") {
        throw new Error(
          `Only \`belongsTo\` relations are supported in v1. Problem: ${resource.name}.${relation.name}`
        );
      }
      if (!resourceMap.has(relation.targetResource)) {
        throw new Error(
          `Relation \`${resource.name}.${relation.name}\` points to missing resource \`${relation.targetResource}\`.`
        );
      }
    }
  }

  for (const resource of normalizedResources) {
    for (const relation of resource.relations) {
      if (relation.kind !== "belongsTo") {
        continue;
      }
      const local = relation.localField;
      if (!local) {
        throw new Error(`Relation \`${resource.name}.${relation.name}\` must define \`localField\`.`);
      }
      if (local === "id" || local === "owner_id") {
        throw new Error(
          `Relation \`${resource.name}.${relation.name}\` cannot use reserved field name \`${local}\` as localField.`
        );
      }
      const existing = resource.fields.find((candidate) => candidate.name === local);
      const ref = {
        resource: relation.targetResource,
        field: relation.targetField || "id",
      };
      if (existing) {
        if (!existing.references) {
          existing.references = ref;
        }
      } else {
        resource.fields.push({
          name: local,
          type: "integer",
          required: false,
          references: ref,
        });
      }
    }
  }

  return {
    meta: {
      configPath: path.basename(configPath),
      generatedAt: new Date().toISOString(),
    },
    resources: normalizedResources,
  };
}

function normalizeRelations(resource) {
  if (!Array.isArray(resource.relations)) {
    return [];
  }

  return resource.relations.map((relation, index) => {
    if (!relation || typeof relation !== "object") {
      throw new Error(`Relation #${index + 1} in resource \`${resource.name}\` must be an object.`);
    }
    if (!relation.name) {
      throw new Error(`Every relation in resource \`${resource.name}\` must define a \`name\`.`);
    }

    const referenceSpec = relation.references;
    const targetResource =
      typeof referenceSpec === "string"
        ? referenceSpec
        : referenceSpec?.resource || relation.targetResource;
    const targetField =
      (referenceSpec && typeof referenceSpec === "object" ? referenceSpec.field : null) ||
      relation.targetField ||
      "id";
    const localField = relation.localField || `${toKebabCase(relation.name).replace(/-/g, "_")}_id`;

    return {
      name: relation.name,
      kind: "belongsTo",
      localField,
      targetResource,
      targetField,
    };
  });
}

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

module.exports = {
  loadApiConfig,
  normalizeConfig,
  normalizeRelations,
  toKebabCase,
};
