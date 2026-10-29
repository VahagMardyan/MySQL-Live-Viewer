/**
 * Repository for table metadata (information_schema).
 * Returns plain rows; turning them into the API model is the service's job.
 */
class SchemaRepository {
  #db;
  #dialect;

  constructor(db, dialect) {
    this.#db = db;
    this.#dialect = dialect;
  }

  // TABLE_ROWS is MySQL's row estimate: instant to read, but approximate for InnoDB
  // and NULL for views.
  async listTables() {
    return this.#db.query(`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS estimatedRows
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`);
  }

  async findTable(name) {
    const [table] = await this.#db.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS estimatedRows
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [name]
    );
    return table ?? null;
  }

  async getColumns(table) {
    const rows = await this.#db.query(
      `SELECT ORDINAL_POSITION AS position, COLUMN_NAME AS name, COLUMN_TYPE AS type,
              DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS rawDefault,
              COLUMN_KEY AS columnKey, EXTRA AS extra, COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [table]
    );
    return rows.map((row) => {
      const nullable = row.isNullable === "YES";
      return {
        ...row,
        nullable,
        default: this.#dialect.parseDefault({ ...row, nullable }),
      };
    });
  }

  /** PRIMARY KEY and UNIQUE constraints, grouped: [{ name, type, columns }]. */
  async getKeyConstraints(table) {
    const rows = await this.#db.query(
      `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type, k.COLUMN_NAME AS columnName
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE k
         ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND k.TABLE_NAME = tc.TABLE_NAME
       WHERE tc.TABLE_SCHEMA = DATABASE()
         AND tc.TABLE_NAME = ?
         AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
       ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [table]
    );
    return SchemaRepository.#group(rows, (row) => ({ name: row.name, type: row.type }), (row) => ({
      columns: [row.columnName],
    }));
  }

  /** Foreign keys, grouped: [{ name, columns, referencedTable, referencedColumns, onUpdate, onDelete }]. */
  async getForeignKeys(table) {
    const rows = await this.#db.query(
      `SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
              k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
              r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        AND r.TABLE_NAME = k.TABLE_NAME
       WHERE k.TABLE_SCHEMA = DATABASE()
         AND k.TABLE_NAME = ?
         AND k.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [table]
    );
    return SchemaRepository.#group(
      rows,
      (row) => ({
        name: row.name,
        referencedTable: row.referencedTable,
        onUpdate: row.onUpdate,
        onDelete: row.onDelete,
      }),
      (row) => ({ columns: [row.columnName], referencedColumns: [row.referencedColumn] })
    );
  }

  /** Names of columns that start an index, i.e. columns MySQL can sort or group by without a full scan. */
  async getIndexedColumns(table) {
    const rows = await this.#db.query(
      `SELECT DISTINCT COLUMN_NAME AS name
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND SEQ_IN_INDEX = 1`,
      [table]
    );
    return new Set(rows.map((r) => r.name));
  }

  async getCheckConstraints(table) {
    try {
      return await this.#db.query(this.#dialect.checkConstraintsSql(), [table]);
    } catch (err) {
      // MySQL before 8.0.16 has no CHECK_CONSTRAINTS table; treat that as "no checks".
      if (err.code === "ER_UNKNOWN_TABLE" || err.code === "ER_NO_SUCH_TABLE") return [];
      throw err;
    }
  }

  /**
   * Groups one-row-per-column results into one object per constraint name.
   * `head` builds the shared fields, `parts` builds the array fields to concatenate.
   */
  static #group(rows, head, parts) {
    const byName = new Map();
    for (const row of rows) {
      const item = byName.get(row.name);
      const next = parts(row);
      if (!item) {
        byName.set(row.name, { ...head(row), ...next });
      } else {
        for (const [key, values] of Object.entries(next)) item[key].push(...values);
      }
    }
    return [...byName.values()];
  }
}

module.exports = { SchemaRepository };
