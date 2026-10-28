const { NotFoundError } = require("../errors");

// Flags MySQL stores in EXTRA that the API reports as separate fields.
const HANDLED_EXTRA = /\b(auto_increment|DEFAULT_GENERATED)\b/gi;

/**
 * Service layer: combines the repositories into the models the API returns.
 * Controllers call this class; it never touches HTTP.
 */
class TableService {
  #schema;
  #rows;
  #limits;

  constructor({ schemaRepository, rowRepository, rowLimitPolicy }) {
    this.#schema = schemaRepository;
    this.#rows = rowRepository;
    this.#limits = rowLimitPolicy;
  }

  async listTables() {
    const tables = await this.#schema.listTables();
    return Promise.all(
      tables.map(async (table) => ({
        name: table.name,
        isView: table.type === "VIEW",
        rows: await this.#rows.count(table.name),
      }))
    );
  }

  async getStructure(name) {
    const table = await this.#requireTable(name);
    const [columns, keys, foreignKeys, checks] = await Promise.all([
      this.#schema.getColumns(name),
      this.#schema.getKeyConstraints(name),
      this.#schema.getForeignKeys(name),
      this.#schema.getCheckConstraints(name),
    ]);

    const primaryKey = keys.find((k) => k.type === "PRIMARY KEY")?.columns ?? [];
    const uniqueConstraints = keys
      .filter((k) => k.type === "UNIQUE")
      .map(({ name: constraint, columns: cols }) => ({ name: constraint, columns: cols }));

    return {
      table: name,
      isView: table.type === "VIEW",
      columns: columns.map((col) => this.#describeColumn(col, { primaryKey, uniqueConstraints, foreignKeys })),
      primaryKey,
      uniqueConstraints,
      foreignKeys,
      checkConstraints: checks,
    };
  }

  async getRows(name, requestedLimit) {
    const limit = this.#limits.resolve(requestedLimit);
    await this.#requireTable(name);

    const [columns, keys] = await Promise.all([
      this.#schema.getColumns(name),
      this.#schema.getKeyConstraints(name),
    ]);
    const primaryKey = keys.find((k) => k.type === "PRIMARY KEY")?.columns ?? [];

    const [rows, totalRows] = await Promise.all([
      this.#rows.fetch(name, { orderBy: primaryKey, limit }),
      this.#rows.count(name),
    ]);

    return {
      table: name,
      columns: columns.map(({ name: col, type }) => ({ name: col, type })),
      primaryKey,
      rows,
      limit,
      totalRows,
    };
  }

  async #requireTable(name) {
    const table = await this.#schema.findTable(name);
    if (!table) throw new NotFoundError(`Unknown table "${name}"`);
    return table;
  }

  #describeColumn(col, { primaryKey, uniqueConstraints, foreignKeys }) {
    const fk = foreignKeys.find((f) => f.columns.includes(col.name));
    const references = fk
      ? {
          constraint: fk.name,
          table: fk.referencedTable,
          column: fk.referencedColumns[fk.columns.indexOf(col.name)],
        }
      : null;

    return {
      position: col.position,
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      default: col.default,
      primaryKey: primaryKey.includes(col.name),
      // Only single-column UNIQUE constraints make the column itself unique.
      unique: uniqueConstraints.some((u) => u.columns.length === 1 && u.columns[0] === col.name),
      autoIncrement: /auto_increment/i.test(col.extra),
      references,
      extra: col.extra.replace(HANDLED_EXTRA, "").replace(/\s+/g, " ").trim(),
      comment: col.comment,
    };
  }
}

module.exports = { TableService };
