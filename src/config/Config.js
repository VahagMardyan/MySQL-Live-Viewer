const { ConfigError } = require("../errors");

// Rows per page offered in the UI. The first matching DEFAULT_PAGE_SIZE is preselected.
const PAGE_SIZES = Object.freeze([100, 250, 500, 1000]);
const DEFAULT_PAGE_SIZE = 250;

// Tables estimated above this many rows show MySQL's row estimate in the tabs
// instead of running COUNT(*) on every refresh.
const EXACT_COUNT_THRESHOLD = 100_000;

// How long an exact COUNT(*) of a large table is reused before it is run again.
const COUNT_CACHE_MS = 15_000;

// After entering the MySQL password, editing stays unlocked this long after the last change.
const WRITE_SESSION_MS = 5 * 60_000;

/**
 * Immutable application settings, built from environment variables.
 * Use Config.fromEnv(process.env) instead of calling the constructor directly.
 */
class Config {
  constructor({ db, host, port, pageSizes, defaultPageSize, exactCountThreshold, countCacheMs, writeSessionMs }) {
    this.db = Object.freeze({ ...db });
    this.host = host;
    this.port = port;
    this.writeSessionMs = writeSessionMs;
    this.pageSizes = pageSizes;
    this.defaultPageSize = defaultPageSize;
    this.exactCountThreshold = exactCountThreshold;
    this.countCacheMs = countCacheMs;
    Object.freeze(this);
  }

  static fromEnv(env) {
    const missing = ["DB_USER", "DB_NAME"].filter((key) => !env[key]);
    if (missing.length) {
      throw new ConfigError(
        `Missing ${missing.join(", ")} in environment. Did you create .env from .env.example?`
      );
    }

    return new Config({
      db: {
        host: env.DB_HOST || "localhost",
        port: Config.#toPort(env.DB_PORT, 3306, "DB_PORT"),
        user: env.DB_USER,
        password: env.DB_PASSWORD ?? "",
        database: env.DB_NAME,
      },
      // Only this computer can open the viewer unless HOST is changed (e.g. 0.0.0.0 for your network).
      host: env.HOST || "127.0.0.1",
      port: Config.#toPort(env.PORT, 3000, "PORT"),
      writeSessionMs: WRITE_SESSION_MS,
      pageSizes: PAGE_SIZES,
      defaultPageSize: DEFAULT_PAGE_SIZE,
      exactCountThreshold: EXACT_COUNT_THRESHOLD,
      countCacheMs: COUNT_CACHE_MS,
    });
  }

  static #toPort(value, fallback, name) {
    if (value === undefined || value === "") return fallback;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError(`${name} must be a port number between 1 and 65535, got "${value}".`);
    }
    return port;
  }
}

module.exports = { Config };
