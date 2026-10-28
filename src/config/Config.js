const { ConfigError } = require("../errors");

const ROW_LIMITS = Object.freeze([1000, 2000, 5000, 10000]);

/**
 * Immutable application settings, built from environment variables.
 * Use Config.fromEnv(process.env) instead of calling the constructor directly.
 */
class Config {
  constructor({ db, port, rowLimits, defaultRowLimit }) {
    this.db = Object.freeze({ ...db });
    this.port = port;
    this.rowLimits = rowLimits;
    this.defaultRowLimit = defaultRowLimit;
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
      rowLimits: ROW_LIMITS,
      defaultRowLimit: ROW_LIMITS[0],
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
