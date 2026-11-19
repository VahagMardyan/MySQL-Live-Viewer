const { LockedError } = require("../errors");

/**
 * One unlocked editing session: a dedicated MySQL connection opened with the
 * username and password the user typed. The password itself is never stored;
 * the open connection is the proof that it was correct.
 *
 * Tasks run one at a time (a small queue), so a transaction from one request
 * can never interleave with statements from another.
 */
class WriteSession {
  #connection;
  #ttlMs;
  #queue = Promise.resolve();
  #executor;

  constructor({ token, user, connection, ttlMs }) {
    this.token = token;
    this.user = user;
    this.closed = false;
    this.#connection = connection;
    this.#ttlMs = ttlMs;
    this.touch();

    // A dropped connection (server restart, timeout) simply locks editing again.
    connection.on("error", () => this.close());

    const executor = {
      query: async (sql, params = []) => (await connection.query(sql, params))[0],
      transaction: async (work) => {
        await connection.beginTransaction();
        try {
          const result = await work(executor);
          await connection.commit();
          return result;
        } catch (err) {
          await connection.rollback().catch(() => {});
          throw err;
        }
      },
    };
    this.#executor = executor;
  }

  /** Extends the session: editing stays unlocked for ttlMs after the last change. */
  touch() {
    this.expiresAt = Date.now() + this.#ttlMs;
  }

  get expired() {
    return Date.now() >= this.expiresAt;
  }

  get ttlMs() {
    return this.#ttlMs;
  }

  /** Runs task(executor) after any earlier task of this session has finished. */
  run(task) {
    const result = this.#queue.then(() => {
      if (this.closed) throw new LockedError();
      return task(this.#executor);
    });
    this.#queue = result.catch(() => {});
    return result;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.#connection.end();
    } catch {
      this.#connection.destroy();
    }
  }
}

module.exports = { WriteSession };
