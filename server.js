// Composition root: creates every object and wires the dependencies together.
const path = require("path");
const { Config } = require("./src/config/Config");
const { Database } = require("./src/db/Database");
const { DialectFactory } = require("./src/db/dialects/DialectFactory");
const { SchemaRepository } = require("./src/repositories/SchemaRepository");
const { RowRepository } = require("./src/repositories/RowRepository");
const { GroupRepository } = require("./src/repositories/GroupRepository");
const { GroupService } = require("./src/services/GroupService");
const { PageSizePolicy } = require("./src/services/PageSizePolicy");
const { RowCounter } = require("./src/services/RowCounter");
const { TableService } = require("./src/services/TableService");
const { TableController } = require("./src/http/TableController");
const { WebServer } = require("./src/http/WebServer");

async function main() {
  const config = Config.fromEnv(process.env);

  let version;
  try {
    version = await Database.detectVersion(config.db);
  } catch (err) {
    throw new Error(`Cannot connect to the database: ${err.message}`);
  }
  const dialect = DialectFactory.fromVersion(version);
  const db = new Database(config.db, { sessionSql: dialect.sessionSql() });

  const schemaRepository = new SchemaRepository(db, dialect);
  const rowRepository = new RowRepository(db);
  const pageSizePolicy = new PageSizePolicy(config.pageSizes, config.defaultPageSize);
  const groupService = new GroupService({
    schemaRepository,
    groupRepository: new GroupRepository(db),
    pageSizePolicy,
  });
  const tableService = new TableService({
    schemaRepository,
    rowRepository,
    pageSizePolicy,
    rowCounter: new RowCounter(rowRepository, {
      threshold: config.exactCountThreshold,
      ttlMs: config.countCacheMs,
    }),
  });

  const controller = new TableController({
    tableService,
    groupService,
    meta: {
      database: config.db.database,
      server: `${dialect.name} ${version}`,
      pageSizes: pageSizePolicy.allowed,
      defaultPageSize: pageSizePolicy.default,
      aggregateFunctions: GroupRepository.functions,
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
