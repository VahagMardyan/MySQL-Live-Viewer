/**
 * All SQL that changes data or structure. It runs on the connection of an unlocked
 * WriteSession (`executor`), never on the read-only pool, so the database itself
 * enforces what the logged-in MySQL user may do.
 */
class EditRepository {
  #db;

  constructor(executor) {
    this.#db = executor;
  }

  /** @param values [[column, value], ...]; columns left out get their DEFAULT. */
  async insert(table, values) {
    if (!values.length) return this.#db.query("INSERT INTO ?? () VALUES ()", [table]);
    const cols = values.map(() => "??").join(", ");
    const marks = values.map(() => "?").join(", ");
    return this.#db.query(`INSERT INTO ?? (${cols}) VALUES (${marks})`, [
      table, ...values.map(([c]) => c), ...values.map(([, v]) => v),
    ]);
  }

  /**
   * Updates one row. `where` pairs are compared null-safely (<=>), so a row only
   * matches if none of the checked values changed since the user opened it.
   * @returns affectedRows: rows matched (mysql2 sets FOUND_ROWS), 0 or 1
   */
  async update(table, { set, where }) {
    const setSql = set.map(() => "?? = ?").join(", ");
    const whereSql = where.map(() => "?? <=> ?").join(" AND ");
    const result = await this.#db.query(`UPDATE ?? SET ${setSql} WHERE ${whereSql} LIMIT 1`, [
      table, ...set.flat(), ...where.flat(),
    ]);
    return result.affectedRows;
  }

  async exists(table, where) {
    const whereSql = where.map(() => "?? <=> ?").join(" AND ");
    const rows = await this.#db.query(`SELECT 1 FROM ?? WHERE ${whereSql} LIMIT 1`, [table, ...where.flat()]);
    return rows.length > 0;
  }

  /**
   * Deletes rows by primary key in one transaction.
   * @param keyColumns ["order_id"] or ["a", "b"]
   * @param keys       [[1], [2]] or [[1, "x"], [2, "y"]]
   */
  async deleteByKeys(table, keyColumns, keys) {
    return this.#db.transaction(async (tx) => {
      const tuple = `(${keyColumns.map(() => "??").join(", ")})`;
      const row = `(${keyColumns.map(() => "?").join(", ")})`;
      const result = await tx.query(
        `DELETE FROM ?? WHERE ${tuple} IN (${keys.map(() => row).join(", ")})`,
        [table, ...keyColumns, ...keys.flat()]
      );
      return result.affectedRows;
    });
  }

  async truncate(table) {
    await this.#db.query("TRUNCATE TABLE ??", [table]);
  }

  async maxValue(table, column) {
    const [row] = await this.#db.query("SELECT MAX(??) AS m FROM ??", [column, table]);
    return row.m;
  }

  /** @param value digits only, checked by the caller (ALTER TABLE needs a bare number). */
  async setAutoIncrement(table, value) {
    await this.#db.query(`ALTER TABLE ?? AUTO_INCREMENT = ${value}`, [table]);
  }

  async addColumn(table, definition, position) {
    await this.#db.query(`ALTER TABLE ?? ADD COLUMN ${definition.sql}${position.sql}`, [
      table, ...definition.params, ...position.params,
    ]);
  }

  async changeColumn(table, column, definition, position) {
    await this.#db.query(`ALTER TABLE ?? CHANGE COLUMN ?? ${definition.sql}${position.sql}`, [
      table, column, ...definition.params, ...position.params,
    ]);
  }

  async dropColumn(table, column) {
    await this.#db.query("ALTER TABLE ?? DROP COLUMN ??", [table, column]);
  }
}

module.exports = { EditRepository };
