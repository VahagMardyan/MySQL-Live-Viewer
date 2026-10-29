const { ValidationError } = require("../errors");

/**
 * Encodes a row's primary-key values as an opaque, URL-safe string, and back.
 * The client only passes cursors around; it never needs to read them.
 */
class KeyCursor {
  static encode(values) {
    return Buffer.from(JSON.stringify(values)).toString("base64url");
  }

  static decode(cursor, keyLength) {
    let values;
    try {
      values = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    } catch {
      throw new ValidationError("Invalid page cursor");
    }
    const valid =
      Array.isArray(values) &&
      values.length === keyLength &&
      values.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v));
    if (!valid) throw new ValidationError("Invalid page cursor");
    return values;
  }
}

module.exports = { KeyCursor };
