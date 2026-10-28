const { ValidationError } = require("../errors");

/** Decides which row limits clients may ask for. */
class RowLimitPolicy {
  #allowed;
  #fallback;

  constructor(allowed, fallback) {
    this.#allowed = allowed;
    this.#fallback = fallback;
  }

  get allowed() {
    return [...this.#allowed];
  }

  get default() {
    return this.#fallback;
  }

  /** Returns a valid limit, or throws ValidationError for values outside the allowed list. */
  resolve(value) {
    if (value === undefined || value === "") return this.#fallback;
    const limit = Number(value);
    if (!this.#allowed.includes(limit)) {
      throw new ValidationError(`limit must be one of ${this.#allowed.join(", ")}`);
    }
    return limit;
  }
}

module.exports = { RowLimitPolicy };
