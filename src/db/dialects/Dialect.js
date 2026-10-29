/**
 * Strategy interface for the parts of information_schema that differ
 * between MySQL and MariaDB. Subclasses override the methods below.
 */
class Dialect {
  get name() {
    throw new Error("Dialect.name not implemented");
  }

  /** Statements to run on every new connection. */
  sessionSql() {
    return [];
  }

  /** SQL returning { name, clause } rows for one table's CHECK constraints. Param: table name. */
  checkConstraintsSql() {
    throw new Error("Dialect.checkConstraintsSql not implemented");
  }

  /**
   * Turns a raw COLUMN_DEFAULT into { kind, text }.
   * kind: "none" (no default), "null", "value" (a literal) or "expression" (e.g. CURRENT_TIMESTAMP).
   */
  parseDefault(_column) {
    throw new Error("Dialect.parseDefault not implemented");
  }

  static noDefault(nullable) {
    return nullable ? { kind: "null", text: "NULL" } : { kind: "none", text: "" };
  }
}

module.exports = { Dialect };
