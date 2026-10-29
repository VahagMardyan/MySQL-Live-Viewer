/**
 * Repository for reading table data. Table and column names are escaped with ?? placeholders.
 *
 * Paging uses "keyset pagination" wherever possible:
 *   WHERE (sort_col, id) > (last values seen) ORDER BY sort_col, id LIMIT n
 * reads exactly n rows from an index, so every page is equally fast.
 * LIMIT ... OFFSET would read and discard all earlier rows first, which gets
 * slower the deeper you go (about 1.4 s at row 1,900,000 in tests).
 */
class RowRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async count(table) {
    const [row] = await this.#db.query("SELECT COUNT(*) AS n FROM ??", [table]);
    return Number(row.n);
  }

  /**
   * Reads one page.
   * @param order      columns to order by, e.g. ["status", "order_id"]; must end with a unique key for keyset positions
   * @param uniqueKey  primary-key columns, used to make offset jumps cheaper; may be empty
   * @param direction  "ASC" or "DESC", applied to every order column
   * @param position one of:
   *   { type: "first" }
   *   { type: "after",  key: [...] }   rows after these order values (next page)
   *   { type: "before", key: [...] }   rows before these order values (previous page)
   *   { type: "last",   rows: n }      the final n rows
   *   { type: "offset", offset: n }    jump to a row number
   *   { type: "offsetFromEnd", skip: n, take: m }   skip n rows from the end, then take m
   * @returns { rows, hasPrev, hasNext }, rows always in display order
   */
  async page(table, { order, uniqueKey, direction, size, position }) {
    const fwd = direction === "DESC" ? "DESC" : "ASC";
    const rev = fwd === "ASC" ? "DESC" : "ASC";
    const orderSql = (dir) => (order.length ? `ORDER BY ${order.map(() => `?? ${dir}`).join(", ")}` : "");
    const tuple = `(${RowRepository.#names(order.length)})`;
    const marks = `(${order.map(() => "?").join(", ")})`;
    const afterOp = fwd === "ASC" ? ">" : "<";
    const beforeOp = fwd === "ASC" ? "<" : ">";

    switch (position.type) {
      case "first": {
        const rows = await this.#db.query(`SELECT * FROM ?? ${orderSql(fwd)} LIMIT ?`, [table, ...order, size + 1]);
        return { rows: rows.slice(0, size), hasPrev: false, hasNext: rows.length > size };
      }
      case "after": {
        const rows = await this.#db.query(
          `SELECT * FROM ?? WHERE ${tuple} ${afterOp} ${marks} ${orderSql(fwd)} LIMIT ?`,
          [table, ...order, ...position.key, ...order, size + 1]
        );
        return { rows: rows.slice(0, size), hasPrev: true, hasNext: rows.length > size };
      }
      case "before": {
        const rows = await this.#db.query(
          `SELECT * FROM ?? WHERE ${tuple} ${beforeOp} ${marks} ${orderSql(rev)} LIMIT ?`,
          [table, ...order, ...position.key, ...order, size + 1]
        );
        return { rows: rows.slice(0, size).reverse(), hasPrev: rows.length > size, hasNext: true };
      }
      case "last": {
        const n = position.rows;
        const rows = await this.#db.query(`SELECT * FROM ?? ${orderSql(rev)} LIMIT ?`, [table, ...order, n + 1]);
        return { rows: rows.slice(0, n).reverse(), hasPrev: rows.length > n, hasNext: false };
      }
      case "offset": {
        const rows = await this.#skip(table, { order, uniqueKey, dir: fwd, skip: position.offset, take: size + 1, orderSql });
        return { rows: rows.slice(0, size), hasPrev: position.offset > 0, hasNext: rows.length > size };
      }
      case "offsetFromEnd": {
        const { skip, take } = position;
        const rows = await this.#skip(table, { order, uniqueKey, dir: rev, skip, take: take + 1, orderSql });
        return { rows: rows.slice(0, take).reverse(), hasPrev: rows.length > take, hasNext: skip > 0 };
      }
      default:
        throw new Error(`Unknown page position "${position.type}"`);
    }
  }

  // Skips rows by count. With a primary key this is a "deferred join": the skipping
  // reads only key columns, then full rows are fetched for this page alone.
  // That is about 3x faster than a plain OFFSET on large tables.
  async #skip(table, { order, uniqueKey, dir, skip, take, orderSql }) {
    if (!uniqueKey.length) {
      return this.#db.query(`SELECT * FROM ?? ${orderSql(dir)} LIMIT ?, ?`, [table, ...order, skip, take]);
    }
    const keys = RowRepository.#names(uniqueKey.length);
    return this.#db.query(
      `SELECT t.* FROM ?? AS t
       JOIN (SELECT ${keys} FROM ?? ${orderSql(dir)} LIMIT ?, ?) AS k USING (${keys})
       ${orderSql(dir)}`,
      [table, ...uniqueKey, table, ...order, skip, take, ...uniqueKey, ...order]
    );
  }

  static #names(n) {
    return Array(n).fill("??").join(", ");
  }
}

module.exports = { RowRepository };
