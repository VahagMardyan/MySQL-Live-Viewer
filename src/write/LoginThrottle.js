const { TooManyAttemptsError } = require("../errors");

/**
 * Slows down password guessing. After `freeAttempts` wrong passwords from the same
 * client, each further attempt must wait twice as long as the previous one
 * (2 s, 4 s, 8 s ... up to 5 minutes). A correct password resets the counter.
 */
class LoginThrottle {
  #failures = new Map(); // client -> { count, until }
  #freeAttempts;
  #baseDelayMs;
  #maxDelayMs;

  constructor({ freeAttempts = 3, baseDelayMs = 2000, maxDelayMs = 5 * 60_000 } = {}) {
    this.#freeAttempts = freeAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#maxDelayMs = maxDelayMs;
  }

  /** Throws TooManyAttemptsError while the client has to wait. */
  check(client) {
    const entry = this.#failures.get(client);
    const wait = entry ? entry.until - Date.now() : 0;
    if (wait > 0) throw new TooManyAttemptsError(Math.ceil(wait / 1000));
  }

  fail(client) {
    if (this.#failures.size > 1000) this.#failures.clear(); // keep memory bounded
    const entry = this.#failures.get(client) ?? { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= this.#freeAttempts) {
      const delay = this.#baseDelayMs * 2 ** (entry.count - this.#freeAttempts);
      entry.until = Date.now() + Math.min(delay, this.#maxDelayMs);
    }
    this.#failures.set(client, entry);
  }

  reset(client) {
    this.#failures.delete(client);
  }
}

module.exports = { LoginThrottle };
