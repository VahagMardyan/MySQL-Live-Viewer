/**
 * Decides how to count rows, since COUNT(*) has to scan the table in InnoDB
 * (about 150-200 ms for 2 million rows in tests).
 *
 * - estimate(): for the tabs. Small tables get an exact COUNT(*); tables whose
 *   MySQL estimate is above the threshold just show the estimate.
 * - exact(): for the open table. Large tables are counted at most once per cache
 *   period, and the result is reused in between (a simple caching proxy).
 */
class RowCounter {
  #rows;
  #threshold;
  #ttlMs;
  #cache = new Map(); // table -> { value, at }

  constructor(rowRepository, { threshold, ttlMs }) {
    this.#rows = rowRepository;
    this.#threshold = threshold;
    this.#ttlMs = ttlMs;
  }

  /** @returns {{ value: number, exact: boolean }} */
  async estimate(table, estimatedRows) {
    if (this.#isLarge(estimatedRows)) {
      const cached = this.#fresh(table);
      return cached !== null
        ? { value: cached, exact: true }
        : { value: Number(estimatedRows), exact: false };
    }
    return { value: await this.#rows.count(table), exact: true };
  }

  /** @returns {number} exact row count, possibly a few seconds old for large tables */
  async exact(table, estimatedRows) {
    if (!this.#isLarge(estimatedRows)) return this.#rows.count(table);
    const cached = this.#fresh(table);
    if (cached !== null) return cached;
    const value = await this.#rows.count(table);
    this.#cache.set(table, { value, at: Date.now() });
    return value;
  }

  #isLarge(estimatedRows) {
    return estimatedRows != null && Number(estimatedRows) >= this.#threshold;
  }

  #fresh(table) {
    const entry = this.#cache.get(table);
    return entry && Date.now() - entry.at < this.#ttlMs ? entry.value : null;
  }
}

module.exports = { RowCounter };
