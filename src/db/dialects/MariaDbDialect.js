const { Dialect } = require("./Dialect");

const NUMBER_LITERAL = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

class MariaDbDialect extends Dialect {
  get name() {
    return "MariaDB";
  }

  // MariaDB names column-level checks after the column, so names can repeat
  // across tables. Its CHECK_CONSTRAINTS table has TABLE_NAME, so filter on it directly.
  checkConstraintsSql() {
    return `
      SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause
      FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY CONSTRAINT_NAME`;
  }

  // MariaDB stores string literals quoted ("'active'"), NULL as the text "NULL",
  // numbers bare, and anything else is an expression such as current_timestamp().
  parseDefault({ rawDefault, nullable }) {
    // `value` is the plain value without quotes, used to prefill the edit form.
    if (rawDefault === null || rawDefault === "NULL") return Dialect.noDefault(nullable);
    if (rawDefault.startsWith("'")) {
      const value = rawDefault.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, "$1");
      return { kind: "value", text: rawDefault, value };
    }
    if (NUMBER_LITERAL.test(rawDefault)) return { kind: "value", text: rawDefault, value: rawDefault };
    return { kind: "expression", text: rawDefault, value: rawDefault };
  }
}

module.exports = { MariaDbDialect };
