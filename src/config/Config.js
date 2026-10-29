const { ConfigError } = require("../errors");

// Rows per page offered in the UI. The first matching DEFAULT_PAGE_SIZE is preselected.
const PAGE_SIZES = Object.freeze([100, 250, 500, 1000]);
const DEFAULT_PAGE_SIZE = 250;

// Tables estimated above this many rows show MySQL's row estimate in the tabs
// instead of running COUNT(*) on every refresh.
const EXACT_COUNT_THRESHOLD = 100_000;

// How long an exact COUNT(*) of a large table is reused before it is run again.
const COUNT_CACHE_MS = 15_000;

/**
 * Immutable application settings, built from environment variables.
 * Use Config.fromEnv(process.env) instead of calling the constructor directly.
 */
class Config {
  constructor({ db, port, pageSizes, defaultPageSize, exactCountThreshold, countCacheMs }) {
    this.db = Object.freeze({ ...db });
    this.port = port;
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
      port: Config.#toPort(env.PORT, 3000, "PORT"),
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
