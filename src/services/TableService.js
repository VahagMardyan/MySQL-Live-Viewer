const { NotFoundError, ValidationError } = require("../errors");
const { KeyCursor } = require("./KeyCursor");

// Flags MySQL stores in EXTRA that the API reports as separate fields.
const HANDLED_EXTRA = /\b(auto_increment|DEFAULT_GENERATED)\b/gi;

const NUMERIC_TYPES = new Set([
  "tinyint", "smallint", "mediumint", "int", "integer", "bigint",
  "decimal", "numeric", "float", "double", "real", "bit",
]);

/**
 * Service layer: combines the repositories into the models the API returns.
 * Controllers call this class; it never touches HTTP.
 */
class TableService {
  #schema;
  #rows;
  #pageSizes;
  #counter;

  constructor({ schemaRepository, rowRepository, pageSizePolicy, rowCounter }) {
    this.#schema = schemaRepository;
    this.#rows = rowRepository;
    this.#pageSizes = pageSizePolicy;
    this.#counter = rowCounter;
  }

  async listTables() {
    const tables = await this.#schema.listTables();
    return Promise.all(
      tables.map(async (table) => {
        const count = await this.#counter.estimate(table.name, table.estimatedRows);
        return {
          name: table.name,
          isView: table.type === "VIEW",
          rows: count.value,
          exact: count.exact,
        };
      })
    );
  }

  async getStructure(name) {
    const table = await this.#requireTable(name);
    const [columns, keys, foreignKeys, checks, indexed] = await Promise.all([
      this.#schema.getColumns(name),
      this.#schema.getKeyConstraints(name),
      this.#schema.getForeignKeys(name),
      this.#schema.getCheckConstraints(name),
      this.#schema.getIndexedColumns(name),
    ]);

    const primaryKey = keys.find((k) => k.type === "PRIMARY KEY")?.columns ?? [];
    const uniqueConstraints = keys
      .filter((k) => k.type === "UNIQUE")
      .map(({ name: constraint, columns: cols }) => ({ name: constraint, columns: cols }));

    return {
      table: name,
      isView: table.type === "VIEW",
      columns: columns.map((col) => this.#describeColumn(col, { primaryKey, uniqueConstraints, foreignKeys, indexed })),
      primaryKey,
      uniqueConstraints,
      foreignKeys,
      checkConstraints: checks,
    };
  }

  /**
   * One page of rows. `request` comes from the query string:
   *   size          rows per page
   *   sort, dir     optional column to sort by, "asc" (default) or "desc"
   *   page | after | before   position: page number or "last", or a cursor from a previous page
   * Rows are returned as arrays in column order, which is about half the size of objects.
   */
  async getRows(name, request = {}) {
    const size = this.#pageSizes.resolve(request.size);
    const table = await this.#requireTable(name);

    const [columns, keys, indexed] = await Promise.all([
      this.#schema.getColumns(name),
      this.#schema.getKeyConstraints(name),
      this.#schema.getIndexedColumns(name),
    ]);
    const primaryKey = keys.find((k) => k.type === "PRIMARY KEY")?.columns ?? [];
    const sort = TableService.#resolveSort(request, columns);

    // Order by the sort column, then the primary key as a tie-breaker, so the order is
    // unique and pages never overlap.
    const order = sort
      ? [sort.column, ...primaryKey.filter((c) => c !== sort.column)]
      : primaryKey;
    const keyset = TableService.#canUseKeyset({ order, primaryKey, columns });

    const totalRows = await this.#counter.exact(name, table.estimatedRows);
    const totalPages = Math.max(1, Math.ceil(totalRows / size));
    const { position, page } = TableService.#resolvePosition(request, {
      keyset, keyLength: order.length, size, totalRows, totalPages,
    });

    const result = await this.#rows.page(name, {
      order,
      uniqueKey: primaryKey,
      direction: sort?.direction ?? "ASC",
      size,
      position,
    });

    const names = columns.map((c) => c.name);
    const orderValues = (row) => order.map((col) => row[col]);
    const first = result.rows[0];
    const last = result.rows[result.rows.length - 1];

    return {
      table: name,
      columns: columns.map(({ name: col, type }) => ({ name: col, type })),
      primaryKey,
      sort,
      // Sorting by a column without an index makes MySQL sort the whole table for every page.
      sortIndexed: !sort || indexed.has(sort.column),
      keyset,
      rows: result.rows.map((row) => names.map((col) => row[col])),
      pageSize: size,
      page,
      totalRows,
      totalPages,
      hasPrev: result.hasPrev,
      hasNext: result.hasNext,
      firstCursor: keyset && first ? KeyCursor.encode(orderValues(first)) : null,
      lastCursor: keyset && last ? KeyCursor.encode(orderValues(last)) : null,
    };
  }

  static #resolveSort({ sort, dir }, columns) {
    if (sort === undefined || sort === "") return null;
    if (!columns.some((c) => c.name === sort)) throw new ValidationError(`Unknown column "${sort}"`);
    const direction = String(dir ?? "asc").toUpperCase();
    if (direction !== "ASC" && direction !== "DESC") throw new ValidationError('dir must be "asc" or "desc"');
    return { column: sort, direction };
  }

  /**
   * Keyset paging needs a unique order whose values survive a round-trip through JSON
   * and compare reliably. Otherwise the table pages by offset instead (correct, but
   * deep pages are slower).
   */
  static #canUseKeyset({ order, primaryKey, columns }) {
    if (!primaryKey.length) return false; // no unique tie-breaker
    const byName = new Map(columns.map((c) => [c.name, c]));
    return order.every((name) => {
      const col = byName.get(name);
      // NULLs can't be compared with (a, b) > (x, y); FLOAT values don't round-trip exactly;
      // binary, JSON and spatial values don't fit in a JSON cursor.
      if (col.nullable) return false;
      return !/^(float|.*binary|.*blob|json|geometry|point|linestring|polygon|multi.*|geometrycollection)$/i.test(col.dataType);
    });
  }

  /** Turns the request into a repository position, plus the page number when it is known. */
  static #resolvePosition({ after, before, page }, { keyset, keyLength, size, totalRows, totalPages }) {
    if (after !== undefined || before !== undefined) {
      if (!keyset) throw new ValidationError("This table or sort order can't use cursors; use page=N instead");
      return after !== undefined
        ? { position: { type: "after", key: KeyCursor.decode(after, keyLength) }, page: null }
        : { position: { type: "before", key: KeyCursor.decode(before, keyLength) }, page: null };
    }

    if (page === "last") {
      const offset = (totalPages - 1) * size;
      const position = keyset
        ? { type: "last", rows: Math.max(1, totalRows - offset) }
        : { type: "offset", offset };
      return { position, page: totalPages };
    }

    if (page === undefined || page === "" || Number(page) === 1) {
      return { position: { type: "first" }, page: 1 };
    }

    const number = Number(page);
    if (!Number.isInteger(number) || number < 1) {
      throw new ValidationError('page must be a positive whole number or "last"');
    }
    const target = Math.min(number, totalPages);
    const start = (target - 1) * size;
    const end = Math.min(start + size, totalRows);

    // Skipping rows costs time, so count from whichever end of the table is closer.
    if (keyset && target === totalPages) {
      return { position: { type: "last", rows: Math.max(1, end - start) }, page: target };
    }
    if (keyset && start > totalRows - end) {
      return { position: { type: "offsetFromEnd", skip: totalRows - end, take: end - start }, page: target };
    }
    return { position: { type: "offset", offset: start }, page: target };
  }

  async #requireTable(name) {
    const table = await this.#schema.findTable(name);
    if (!table) throw new NotFoundError(`Unknown table "${name}"`);
    return table;
  }

  #describeColumn(col, { primaryKey, uniqueConstraints, foreignKeys, indexed }) {
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
      indexed: indexed.has(col.name),
      numeric: NUMERIC_TYPES.has(col.dataType),
      references,
      extra: col.extra.replace(HANDLED_EXTRA, "").replace(/\s+/g, " ").trim(),
      comment: col.comment,
    };
  }
}

module.exports = { TableService };
