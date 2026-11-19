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
const { EditService } = require("./src/services/EditService");
const { WriteSessionManager } = require("./src/write/WriteSessionManager");
const { LoginThrottle } = require("./src/write/LoginThrottle");
const { TableController } = require("./src/http/TableController");
const { EditController } = require("./src/http/EditController");
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
  const rowCounter = new RowCounter(rowRepository, {
    threshold: config.exactCountThreshold,
    ttlMs: config.countCacheMs,
  });
  const tableService = new TableService({
    schemaRepository,
    rowRepository,
    pageSizePolicy,
    rowCounter,
  });

  // Editing: the .env account only reads. Changes run on a separate connection opened
  // with the MySQL username and password the user types in the browser.
  const sessionManager = new WriteSessionManager({
    connect: ({ user, password }) => Database.connect({ ...config.db, user, password }),
    ttlMs: config.writeSessionMs,
    throttle: new LoginThrottle(),
  });
  const editService = new EditService({
    schemaRepository,
    rowRepository,
    onChange: (table) => {
      rowCounter.invalidate(table);
      groupService.invalidate(table);
    },
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
      readUser: config.db.user,
      writeSessionMinutes: Math.round(config.writeSessionMs / 60_000),
    },
  });

  const server = new WebServer({
    host: config.host,
    port: config.port,
    publicDir: path.join(__dirname, "public"),
    controllers: [controller, new EditController({ sessionManager, editService })],
  });

  await server.start();
  const shownHost = ["127.0.0.1", "::1", "0.0.0.0", "::"].includes(config.host) ? "localhost" : config.host;
  console.log(`MySQL Live Viewer running at http://${shownHost}:${config.port}`);
  console.log(`Database: ${config.db.database} @ ${config.db.host}:${config.db.port} (${dialect.name} ${version})`);
  if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) {
    console.log(`Warning: HOST=${config.host} lets other computers on your network open the viewer.`);
  }

  const shutdown = async () => {
    await server.stop();
    await sessionManager.closeAll();
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
