const { ValidationError } = require("../errors");

// Types accepted in the column editor. Anything else is rejected, because the type
// is written into the ALTER TABLE statement as text and can't use a placeholder.
const S = "\\s*";
const NUM = `(${S}unsigned)?(${S}zerofill)?`;
const TYPE_PATTERNS = [
  new RegExp(`^(tinyint|smallint|mediumint|int|integer|bigint)(${S}\\(${S}\\d{1,3}${S}\\))?${NUM}$`, "i"),
  new RegExp(`^(decimal|numeric|dec|fixed)(${S}\\(${S}\\d{1,2}${S}(,${S}\\d{1,2}${S})?\\))?${NUM}$`, "i"),
  new RegExp(`^(float|double|double precision|real)(${S}\\(${S}\\d{1,3}${S}(,${S}\\d{1,2}${S})?\\))?${NUM}$`, "i"),
  new RegExp(`^bit(${S}\\(${S}\\d{1,2}${S}\\))?$`, "i"),
  /^(bool|boolean)$/i,
  new RegExp(`^(char|binary)(${S}\\(${S}\\d{1,3}${S}\\))?$`, "i"),
  new RegExp(`^(varchar|varbinary)${S}\\(${S}\\d{1,5}${S}\\)$`, "i"),
  /^(tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|json)$/i,
  /^(date|year)$/i,
  new RegExp(`^(datetime|timestamp|time)(${S}\\(${S}\\d${S}\\))?$`, "i"),
  /^(geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|geomcollection)$/i,
  // ENUM/SET values: quoted strings, '' for a quote inside. Backslashes aren't allowed,
  // so the text means the same whatever the server's escaping mode is.
  /^(enum|set)\s*\(\s*'(?:[^'\\]|'')*'(?:\s*,\s*'(?:[^'\\]|'')*')*\s*\)$/i,
];

const TEXT_TYPES = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;
const TIMESTAMP_EXPRESSION = /^(current_timestamp|now|localtime|localtimestamp)\s*(\(\s*\d?\s*\))?$/i;

/**
 * Builds the column part of ALTER TABLE ... ADD/CHANGE COLUMN from what the user
 * entered in the column editor, validating every piece first (Builder).
 *
 * input: {
 *   name, type, nullable,
 *   default: { kind: "none" | "null" | "value" | "expression", value },
 *   autoIncrement, onUpdateCurrentTimestamp, comment
 * }
 * existing: the column as it is now (when modifying), used to keep its collation
 * and any default expression the editor can't express.
 */
class ColumnDefinition {
  #input;
  #existing;

  constructor(input, existing = null) {
    if (!input || typeof input !== "object") throw new ValidationError("Missing column definition");
    this.#input = input;
    this.#existing = existing;
  }

  get name() {
    return ColumnDefinition.#name(this.#input.name);
  }

  /** @returns {{ sql: string, params: any[] }} with ?? / ? placeholders for mysql2 */
  build() {
    const input = this.#input;
    const type = ColumnDefinition.#type(input.type);
    const fsp = /^(datetime|timestamp)\s*\(\s*(\d)\s*\)/i.exec(type)?.[2];
    const now = fsp && fsp !== "0" ? `CURRENT_TIMESTAMP(${fsp})` : "CURRENT_TIMESTAMP";

    let sql = `?? ${type}`;
    const params = [this.name];

    // Keep the current collation when the column stays a text column.
    const collation = this.#existing?.collation;
    if (collation && /^\w+$/.test(collation) && TEXT_TYPES.test(type)) sql += ` COLLATE ${collation}`;

    sql += input.nullable ? " NULL" : " NOT NULL";

    const dflt = input.default ?? { kind: "none" };
    switch (dflt.kind) {
      case "none":
        break;
      case "null":
        if (!input.nullable) throw new ValidationError("A NOT NULL column can't default to NULL");
        sql += " DEFAULT NULL";
        break;
      case "value":
        if (dflt.value === undefined || dflt.value === null) throw new ValidationError("Enter a default value");
        sql += " DEFAULT ?";
        params.push(String(dflt.value));
        break;
      case "expression":
        sql += ` DEFAULT ${this.#expression(dflt.value, now)}`;
        break;
      default:
        throw new ValidationError(`Unknown default kind "${dflt.kind}"`);
    }

    if (input.onUpdateCurrentTimestamp) sql += ` ON UPDATE ${now}`;
    if (input.autoIncrement) sql += " AUTO_INCREMENT";
    if (input.comment) {
      sql += " COMMENT ?";
      params.push(String(input.comment));
    }
    return { sql, params };
  }

  // CURRENT_TIMESTAMP and its synonyms are allowed. Any other expression is only
  // accepted unchanged from the existing column (it came from MySQL itself).
  #expression(value, now) {
    const text = String(value ?? "").trim();
    if (TIMESTAMP_EXPRESSION.test(text)) return now;
    const existing = this.#existing?.default;
    if (existing?.kind === "expression" && existing.value === text) {
      return text.startsWith("(") ? text : `(${text})`;
    }
    throw new ValidationError("A default expression can only be CURRENT_TIMESTAMP. Use a plain value instead.");
  }

  static #name(name) {
    if (typeof name !== "string" || !name.trim()) throw new ValidationError("Enter a column name");
    if (name.length > 64) throw new ValidationError("Column names can be at most 64 characters");
    if (name !== name.trimEnd()) throw new ValidationError("Column names can't end with a space");
    return name;
  }

  static #type(type) {
    const text = String(type ?? "").trim().replace(/\s+/g, " ");
    if (!TYPE_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new ValidationError(`Unsupported column type "${text}". Examples: INT, VARCHAR(100), DECIMAL(10,2), DATETIME, TEXT`);
    }
    return text;
  }
}

/** Where to put a column: { type: "first" } or { type: "after", column }. Omitted = keep / end. */
function positionSql(position, columnNames) {
  if (!position || position.type === "keep" || position.type === "end") return { sql: "", params: [] };
  if (position.type === "first") return { sql: " FIRST", params: [] };
  if (position.type === "after" && columnNames.includes(position.column)) {
    return { sql: " AFTER ??", params: [position.column] };
  }
  throw new ValidationError("Invalid column position");
}

module.exports = { ColumnDefinition, positionSql };
