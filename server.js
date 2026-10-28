// Composition root: creates every object and wires the dependencies together.
const path = require("path");
const { Config } = require("./src/config/Config");
const { Database } = require("./src/db/Database");
const { DialectFactory } = require("./src/db/dialects/DialectFactory");
const { SchemaRepository } = require("./src/repositories/SchemaRepository");
const { RowRepository } = require("./src/repositories/RowRepository");
const { RowLimitPolicy } = require("./src/services/RowLimitPolicy");
const { TableService } = require("./src/services/TableService");
const { TableController } = require("./src/http/TableController");
const { WebServer } = require("./src/http/WebServer");

async function main() {
  const config = Config.fromEnv(process.env);
  const db = new Database(config.db);

  let version;
  try {
    version = await db.getVersion();
  } catch (err) {
    await db.close();
    throw new Error(`Cannot connect to the database: ${err.message}`);
  }
  const dialect = DialectFactory.fromVersion(version);

  const rowLimitPolicy = new RowLimitPolicy(config.rowLimits, config.defaultRowLimit);
  const tableService = new TableService({
    schemaRepository: new SchemaRepository(db, dialect),
    rowRepository: new RowRepository(db),
    rowLimitPolicy,
  });

  const controller = new TableController({
    tableService,
    meta: {
      database: config.db.database,
      server: `${dialect.name} ${version}`,
      rowLimits: rowLimitPolicy.allowed,
      defaultRowLimit: rowLimitPolicy.default,
    },
  });

  const server = new WebServer({
    port: config.port,
    publicDir: path.join(__dirname, "public"),
    controllers: [controller],
  });

  await server.start();
  console.log(`MySQL Live Viewer running at http://localhost:${config.port}`);
  console.log(`Database: ${config.db.database} @ ${config.db.host}:${config.db.port} (${dialect.name} ${version})`);

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
