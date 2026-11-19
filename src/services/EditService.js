const { NotFoundError, ValidationError, ConflictError } = require("../errors");
const { EditRepository } = require("../repositories/EditRepository");
const { ColumnDefinition, positionSql } = require("./ColumnDefinition");

const MAX_DELETE = 1000;

// Values the browser can't send back exactly, so they aren't used to detect
// "someone else changed this row": FLOAT is rounded, JSON is reformatted,
// binary values arrive as byte arrays.
const NOT_COMPARABLE = /^(float|json|binary|varbinary|tinyblob|blob|mediumblob|longblob|bit|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|geomcollection)$/i;
const BINARY_LIKE = /^(binary|varbinary|tinyblob|blob|mediumblob|longblob|bit|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|geomcollection)$/i;

/**
 * Changes data and structure. Every method takes the caller's WriteSession and runs
 * its SQL on that session's connection. Validation uses the read-only schema
 * repository, so bad requests are rejected before anything is sent to MySQL.
 */
class EditService {
  #schema;
  #rows;
  #onChange;

  /**
   * @param onChange  called with the table name after every successful change,
   *                  so caches (row counts, groups) can be cleared
   */
  constructor({ schemaRepository, rowRepository, onChange = () => {} }) {
    this.#schema = schemaRepository;
    this.#rows = rowRepository;
    this.#onChange = onChange;
  }

  // ---------- rows ----------

  /** values: { column: value } — columns left out get their default. */
  async insertRow(session, table, values) {
    const { columns } = await this.#context(table);
    const pairs = this.#valuePairs(values, columns);
    const result = await session.run((db) => new EditRepository(db).insert(table, pairs));
    this.#onChange(table);
    return { inserted: result.affectedRows, insertId: result.insertId ? String(result.insertId) : null };
  }

  /**
   * key:      { pkColumn: value } of the row to change
   * original: { column: value } as the user saw it, for every changed column
   * changes:  { column: newValue }
   */
  async updateRow(session, table, { key, original = {}, changes }) {
    const { columns, primaryKey } = await this.#context(table, { needsKey: true });
    const set = this.#valuePairs(changes, columns);
    if (!set.length) throw new ValidationError("Nothing to change");

    const keyPairs = this.#keyPairs(key, primaryKey);
    const byName = new Map(columns.map((c) => [c.name, c]));
    const checks = set
      .filter(([name]) => !primaryKey.includes(name) && !NOT_COMPARABLE.test(byName.get(name).dataType))
      .map(([name]) => {
        if (!(name in original)) throw new ValidationError(`Missing original value of "${name}"`);
        return [name, EditService.#scalar(original[name], name)];
      });

    await session.run(async (db) => {
      const repo = new EditRepository(db);
      const matched = await repo.update(table, { set, where: [...keyPairs, ...checks] });
      if (matched) return;
      if (await repo.exists(table, keyPairs)) {
        throw new ConflictError("Someone changed this row after you opened it. Close the editor to load the current values.");
      }
      throw new NotFoundError("This row no longer exists. It may have been deleted.");
    });
    this.#onChange(table);
    return { updated: 1 };
  }

  /** keys: [{ pkColumn: value }, ...] */
  async deleteRows(session, table, keys) {
    const { primaryKey } = await this.#context(table, { needsKey: true });
    if (!Array.isArray(keys) || !keys.length) throw new ValidationError("Select at least one row");
    if (keys.length > MAX_DELETE) throw new ValidationError(`At most ${MAX_DELETE} rows can be deleted at once`);
    const values = keys.map((key) => this.#keyPairs(key, primaryKey).map(([, v]) => v));

    const deleted = await session.run((db) => new EditRepository(db).deleteByKeys(table, primaryKey, values));
    this.#onChange(table);
    return { deleted };
  }

  // ---------- table ----------

  /** Read-only: what the AUTO_INCREMENT dialog shows. */
  async getAutoIncrement(table) {
    const { column } = await this.#autoIncrementContext(table);
    const [max, next] = await Promise.all([
      this.#rows.max(table, column.name),
      this.#schema.getNextAutoIncrement(table),
    ]);
    return {
      column: column.name,
      next,
      max: max == null ? null : String(max),
      lowest: EditService.#lowest(max).toString(),
    };
  }

  /**
   * Sets the next AUTO_INCREMENT value. Without `value` it resets to the lowest
   * possible value (MAX + 1, or 1 for an empty table). MySQL never goes below
   * MAX + 1, so a lower value is raised to that.
   */
  async resetAutoIncrement(session, table, value) {
    const { column } = await this.#autoIncrementContext(table);
    let requested = null;
    if (value !== undefined && value !== null && value !== "") {
      if (!/^\d{1,20}$/.test(String(value)) || BigInt(value) < 1n) {
        throw new ValidationError("The value must be a whole number of 1 or more");
      }
      requested = BigInt(value);
    }

    const result = await session.run(async (db) => {
      const repo = new EditRepository(db);
      const lowest = EditService.#lowest(await repo.maxValue(table, column.name));
      const target = requested !== null && requested > lowest ? requested : lowest;
      await repo.setAutoIncrement(table, target.toString());
      return { next: target.toString(), raised: requested !== null && requested < lowest };
    });
    this.#onChange(table);
    return result;
  }

  // ---------- columns ----------

  async addColumn(session, table, { column, position }) {
    const { columns } = await this.#context(table, { allowViews: false });
    const definition = new ColumnDefinition(column);
    if (columns.some((c) => c.name.toLowerCase() === definition.name.toLowerCase())) {
      throw new ValidationError(`Column "${definition.name}" already exists`);
    }
    const sql = definition.build();
    const pos = positionSql(position, columns.map((c) => c.name));
    await session.run((db) => new EditRepository(db).addColumn(table, sql, pos));
    this.#onChange(table);
    return { added: definition.name };
  }

  async modifyColumn(session, table, columnName, { column, position }) {
    const { columns } = await this.#context(table, { allowViews: false });
    const existing = columns.find((c) => c.name === columnName);
    if (!existing) throw new NotFoundError(`Unknown column "${columnName}"`);
    if (/\b(VIRTUAL|STORED) GENERATED\b/i.test(existing.extra)) {
      throw new ValidationError("Generated columns can't be changed here");
    }
    const definition = new ColumnDefinition(column, existing);
    const renamed = definition.name !== columnName;
    if (renamed && columns.some((c) => c.name.toLowerCase() === definition.name.toLowerCase() && c.name !== columnName)) {
      throw new ValidationError(`Column "${definition.name}" already exists`);
    }
    const sql = definition.build();
    const others = columns.map((c) => c.name).filter((n) => n !== columnName);
    const pos = positionSql(position, others);
    await session.run((db) => new EditRepository(db).changeColumn(table, columnName, sql, pos));
    this.#onChange(table);
    return { modified: definition.name };
  }

  async dropColumn(session, table, columnName, confirm) {
    const { columns } = await this.#context(table, { allowViews: false });
    if (!columns.some((c) => c.name === columnName)) throw new NotFoundError(`Unknown column "${columnName}"`);
    if (columns.length === 1) throw new ValidationError("A table must keep at least one column. Drop the table instead.");
    if (confirm !== columnName) throw new ValidationError(`Type the column name "${columnName}" to confirm`);
    await session.run((db) => new EditRepository(db).dropColumn(table, columnName));
    this.#onChange(table);
    return { dropped: columnName };
  }

  // ---------- helpers ----------

  async #context(table, { needsKey = false, allowViews = false } = {}) {
    const info = await this.#schema.findTable(table);
    if (!info) throw new NotFoundError(`Unknown table "${table}"`);
    if (info.type === "VIEW" && !allowViews) throw new ValidationError("Views can't be edited here");

    const [columns, keys] = await Promise.all([
      this.#schema.getColumns(table),
      this.#schema.getKeyConstraints(table),
    ]);
    const primaryKey = keys.find((k) => k.type === "PRIMARY KEY")?.columns ?? [];
    if (needsKey && !primaryKey.length) {
      throw new ValidationError("This table has no primary key, so a single row can't be identified safely");
    }
    return { info, columns, primaryKey };
  }

  async #autoIncrementContext(table) {
    const { info, columns } = await this.#context(table);
    const column = columns.find((c) => /auto_increment/i.test(c.extra));
    if (!column) throw new ValidationError("This table has no AUTO_INCREMENT column");
    return { info, column };
  }

  /** Turns { column: value } into [[column, value]], checking names and value types. */
  #valuePairs(values, columns) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new ValidationError("Values must be an object of column: value");
    }
    const byName = new Map(columns.map((c) => [c.name, c]));
    return Object.entries(values).map(([name, value]) => {
      const col = byName.get(name);
      if (!col) throw new ValidationError(`Unknown column "${name}"`);
      if (/\b(VIRTUAL|STORED) GENERATED\b/i.test(col.extra)) {
        throw new ValidationError(`"${name}" is a generated column and can't be set`);
      }
      if (BINARY_LIKE.test(col.dataType)) throw new ValidationError(`"${name}" holds binary data and can't be edited here`);
      return [name, EditService.#scalar(value, name)];
    });
  }

  #keyPairs(key, primaryKey) {
    if (!key || typeof key !== "object") throw new ValidationError("Missing row key");
    return primaryKey.map((name) => {
      if (!(name in key)) throw new ValidationError(`Row key is missing "${name}"`);
      return [name, EditService.#scalar(key[name], name)];
    });
  }

  static #scalar(value, name) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    throw new ValidationError(`Invalid value for "${name}"`);
  }

  static #lowest(max) {
    return max == null ? 1n : BigInt(String(max).split(".")[0]) + 1n;
  }
}

module.exports = { EditService };
