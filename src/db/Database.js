const mysql = require("mysql2/promise");

/**
 * Thin wrapper around a mysql2 connection pool.
 * The rest of the app depends on this class, not on mysql2 directly.
 */
class Database {
  #pool;

  /**
   * @param options     mysql2 connection options (host, user, ...)
   * @param sessionSql  statements run once on every new pooled connection
   */
  constructor(options, { sessionSql = [] } = {}) {
    this.#pool = mysql.createPool({
      ...options,
      connectionLimit: 5,
      dateStrings: true,
      // BIGINT values above 2^53 would lose precision as JS numbers, so they arrive as strings.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    if (sessionSql.length) {
      // Fires with the callback-style connection; queued commands run in order,
      // so these finish before the connection serves any other query.
      this.#pool.on("connection", (conn) => {
        // Errors are ignored: e.g. the variable may not exist on older servers.
        for (const sql of sessionSql) conn.query(sql, () => {});
      });
    }
  }

  /** Connects once, reads VERSION() and disconnects. Used to pick the dialect before building the pool. */
  static async detectVersion(options) {
    const conn = await mysql.createConnection(options);
    try {
      const [[row]] = await conn.query("SELECT VERSION() AS version");
      return row.version;
    } finally {
      await conn.end();
    }
  }

  /** Runs a query and returns only the result rows. */
  async query(sql, params = []) {
    const [rows] = await this.#pool.query(sql, params);
    return rows;
  }

  async close() {
    await this.#pool.end();
  }
}

module.exports = { Database };
