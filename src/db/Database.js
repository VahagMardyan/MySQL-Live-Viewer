const mysql = require("mysql2/promise");

/**
 * Thin wrapper around a mysql2 connection pool.
 * The rest of the app depends on this class, not on mysql2 directly.
 */
class Database {
  #pool;

  constructor(options) {
    this.#pool = mysql.createPool({
      ...options,
      connectionLimit: 5,
      dateStrings: true,
    });
  }

  /** Runs a query and returns only the result rows. */
  async query(sql, params = []) {
    const [rows] = await this.#pool.query(sql, params);
    return rows;
  }

  async getVersion() {
    const [row] = await this.query("SELECT VERSION() AS version");
    return row.version;
  }

  async close() {
    await this.#pool.end();
  }
}

module.exports = { Database };
