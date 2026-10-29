const { NotFoundError, ValidationError } = require("../errors");
const { GroupRepository } = require("../repositories/GroupRepository");

const MAX_AGGREGATES = 4;
const SLOW_MS = 300;
const CACHE_MS = 10_000;
const NUMERIC_ONLY = new Set(["sum", "avg"]);
const NUMERIC_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit)$/i;

/** Builds "GROUP BY column" results with a row count and optional aggregates per group. */
class GroupService {
  #schema;
  #groups;
  #pageSizes;
  #cache = new Map(); // request -> result, only for slow queries

  constructor({ schemaRepository, groupRepository, pageSizePolicy }) {
    this.#schema = schemaRepository;
    this.#groups = groupRepository;
    this.#pageSizes = pageSizePolicy;
  }

  /**
   * request (from the query string):
   *   by        column to group by (required)
   *   agg       aggregates as "fn:column", comma-separated, e.g. "sum:amount,max:order_date"
   *   sort      "group", "count" (default) or an aggregate index "0", "1", ...
   *   dir       "asc" or "desc" (default)
   *   size, page
   */
  async getGroups(name, request = {}) {
    const size = this.#pageSizes.resolve(request.size);
    const table = await this.#schema.findTable(name);
    if (!table) throw new NotFoundError(`Unknown table "${name}"`);

    const [columns, indexed] = await Promise.all([
      this.#schema.getColumns(name),
      this.#schema.getIndexedColumns(name),
    ]);
    const byName = new Map(columns.map((c) => [c.name, c]));

    const column = request.by;
    if (!byName.has(column)) throw new ValidationError(`Unknown group column "${column ?? ""}"`);
    const aggregates = GroupService.#parseAggregates(request.agg, byName);
    const sortBy = GroupService.#parseSort(request.sort, aggregates.length);
    const direction = String(request.dir ?? "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";

    const page = Number(request.page ?? 1);
    if (!Number.isInteger(page) || page < 1) throw new ValidationError("page must be a positive whole number");

    const query = { column, aggregates, sortBy, direction, limit: size };
    let result = await this.#cachedGroups(name, { ...query, offset: (page - 1) * size });
    let currentPage = page;

    // Past the last page (e.g. groups disappeared): show the last page that exists.
    if (!result.groups.length && page > 1) {
      const probe = await this.#cachedGroups(name, { ...query, offset: 0, limit: 1 });
      const lastPage = Math.max(1, Math.ceil((probe.totalGroups ?? 0) / size));
      currentPage = lastPage;
      result = await this.#cachedGroups(name, { ...query, offset: (lastPage - 1) * size });
    }

    const totalGroups = result.totalGroups ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalGroups / size));

    return {
      table: name,
      column: { name: column, type: byName.get(column).type },
      aggregates: aggregates.map((a) => ({ ...a, label: `${a.fn.replace("_", " ").toUpperCase()}(${a.column})` })),
      sortBy,
      direction,
      // Grouping by a column without an index means a full table scan on every refresh.
      indexed: indexed.has(column),
      groups: result.groups,
      totalGroups,
      computedAt: result.computedAt,
      pageSize: size,
      page: currentPage,
      totalPages,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
    };
  }

  /**
   * GROUP BY must read the whole table (about 1-2.5 s for 2 million rows in tests).
   * Results that took longer than SLOW_MS are reused for CACHE_MS, so a 2-second
   * refresh doesn't keep the database permanently busy. Fast results are never cached.
   */
  async #cachedGroups(table, query) {
    const key = JSON.stringify([table, query]);
    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.computedAt < CACHE_MS) return hit;

    const started = Date.now();
    const result = { ...(await this.#groups.groups(table, query)), computedAt: started };
    if (Date.now() - started > SLOW_MS) {
      if (this.#cache.size >= 50) this.#cache.clear();
      this.#cache.set(key, result);
    }
    return result;
  }

  static #parseAggregates(agg, byName) {
    if (agg === undefined || agg === "") return [];
    const parts = String(agg).split(",");
    if (parts.length > MAX_AGGREGATES) throw new ValidationError(`At most ${MAX_AGGREGATES} aggregates are allowed`);

    return parts.map((part) => {
      const sep = part.indexOf(":");
      const fn = part.slice(0, sep).toLowerCase();
      const column = part.slice(sep + 1);
      if (sep < 1 || !GroupRepository.functions.includes(fn)) {
        throw new ValidationError(`Unknown aggregate "${part}". Use one of: ${GroupRepository.functions.join(", ")}`);
      }
      const col = byName.get(column);
      if (!col) throw new ValidationError(`Unknown aggregate column "${column}"`);
      if (NUMERIC_ONLY.has(fn) && !NUMERIC_TYPES.test(col.dataType)) {
        throw new ValidationError(`${fn.toUpperCase()} needs a numeric column; "${column}" is ${col.type}`);
      }
      return { fn, column };
    });
  }

  static #parseSort(sort, aggregateCount) {
    if (sort === undefined || sort === "" || sort === "count") return "count";
    if (sort === "group") return "group";
    const index = Number(sort);
    if (Number.isInteger(index) && index >= 0 && index < aggregateCount) return index;
    throw new ValidationError('sort must be "group", "count" or an aggregate index');
  }
}

module.exports = { GroupService };
