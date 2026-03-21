const path = require("path");
const { loadApiConfig } = require("../generator/config");
const { writeArtifacts } = require("../generator/artifacts");
const { recreateDatabase } = require("../runtime/db");

function main() {
  const projectRoot = path.resolve(__dirname, "../..");
  const configPath = path.join(projectRoot, "api.config.yaml");

  const config = loadApiConfig(configPath);
  writeArtifacts(projectRoot, config);
  const dbPath = recreateDatabase(projectRoot);

  console.log(`Generated ${config.resources.length} resource(s) from ${path.basename(configPath)}.`);
  console.log(`Recreated SQLite database at ${dbPath}.`);
}

main();
