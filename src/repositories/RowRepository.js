/** Repository for reading table data. Table and column names are escaped with ?? placeholders. */
class RowRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async count(table) {
    const [row] = await this.#db.query("SELECT COUNT(*) AS n FROM ??", [table]);
    return Number(row.n);
  }

  async fetch(table, { orderBy = [], limit }) {
    const order = orderBy.length
      ? ` ORDER BY ${orderBy.map(() => "??").join(", ")}`
      : "";
    return this.#db.query(`SELECT * FROM ??${order} LIMIT ?`, [table, ...orderBy, limit]);
  }
}

module.exports = { RowRepository };
