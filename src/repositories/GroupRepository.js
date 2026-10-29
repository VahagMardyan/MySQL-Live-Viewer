// SQL for each allowed aggregate function. Only these can be requested.
const AGGREGATES = Object.freeze({
  sum: "SUM(??)",
  avg: "AVG(??)",
  min: "MIN(??)",
  max: "MAX(??)",
  count_distinct: "COUNT(DISTINCT ??)",
});

/** Repository for GROUP BY queries. */
class GroupRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  static get functions() {
    return Object.keys(AGGREGATES);
  }

  /**
   * One page of groups for `column`, each with COUNT(*) and the requested aggregates.
   * @param aggregates [{ fn, column }]
   * @param sortBy     "group", "count", or an aggregate index (0, 1, ...)
   * @returns { groups: [[groupValue, count, ...aggregateValues]], totalGroups }
   */
  async groups(table, { column, aggregates, sortBy, direction, offset, limit }) {
    const aggSql = aggregates.map((a, i) => `, ${AGGREGATES[a.fn]} AS ??`).join("");
    const aggParams = aggregates.flatMap((a, i) => [a.column, `a${i}`]);
    const sortAlias = sortBy === "group" ? "g" : sortBy === "count" ? "cnt" : `a${sortBy}`;
    const dir = direction === "ASC" ? "ASC" : "DESC";

    // COUNT(*) OVER () counts the groups in the same pass, so no second query is needed.
    const rows = await this.#db.query(
      `SELECT ?? AS g, COUNT(*) AS cnt${aggSql}, COUNT(*) OVER () AS total_groups
       FROM ??
       GROUP BY ??
       ORDER BY ?? ${dir}, g ASC
       LIMIT ?, ?`,
      [column, ...aggParams, table, column, sortAlias, offset, limit]
    );

    return {
      groups: rows.map((r) => [r.g, Number(r.cnt), ...aggregates.map((_, i) => r[`a${i}`])]),
      totalGroups: rows.length ? Number(rows[0].total_groups) : null,
    };
  }
}

module.exports = { GroupRepository };
