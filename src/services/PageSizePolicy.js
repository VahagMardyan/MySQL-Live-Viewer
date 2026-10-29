const { ValidationError } = require("../errors");

/** Decides which page sizes clients may ask for. */
class PageSizePolicy {
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

  /** Returns a valid page size, or throws ValidationError for values outside the allowed list. */
  resolve(value) {
    if (value === undefined || value === "") return this.#fallback;
    const size = Number(value);
    if (!this.#allowed.includes(size)) {
      throw new ValidationError(`size must be one of ${this.#allowed.join(", ")}`);
    }
    return size;
  }
}

module.exports = { PageSizePolicy };
