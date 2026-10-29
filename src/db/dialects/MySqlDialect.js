const { Dialect } = require("./Dialect");

const NUMERIC_TYPES = new Set([
  "tinyint", "smallint", "mediumint", "int", "integer", "bigint",
  "decimal", "numeric", "float", "double", "real", "bit",
]);

class MySqlDialect extends Dialect {
  get name() {
    return "MySQL";
  }

  // MySQL 8 caches information_schema row estimates for 24 hours by default,
  // so a table that just grew would keep showing its old size. Turn the cache off.
  sessionSql() {
    return ["SET SESSION information_schema_stats_expiry = 0"];
  }

  // MySQL's CHECK_CONSTRAINTS has no TABLE_NAME column, so join through TABLE_CONSTRAINTS.
  // Constraint names are unique per schema in MySQL, so joining on the name is safe.
  checkConstraintsSql() {
    return `
      SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = ?
        AND tc.CONSTRAINT_TYPE = 'CHECK'
      ORDER BY tc.CONSTRAINT_NAME`;
  }

  // MySQL stores literals unquoted ("active", "0") and marks expressions
  // like CURRENT_TIMESTAMP with DEFAULT_GENERATED in EXTRA.
  parseDefault({ rawDefault, nullable, extra, dataType }) {
    if (rawDefault === null) return Dialect.noDefault(nullable);
    if (/DEFAULT_GENERATED/i.test(extra)) return { kind: "expression", text: rawDefault };
    if (NUMERIC_TYPES.has(dataType)) return { kind: "value", text: rawDefault };
    return { kind: "value", text: `'${rawDefault}'` };
  }
}

module.exports = { MySqlDialect };
