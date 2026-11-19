const { randomBytes } = require("crypto");
const { AppError, AuthError, LockedError, ValidationError } = require("../errors");
const { WriteSession } = require("./WriteSession");

/**
 * Unlocks editing. open() checks a MySQL username and password by connecting with
 * them; on success it returns a session whose random token the browser sends with
 * every change (X-Write-Token header). Sessions expire after a few idle minutes.
 */
class WriteSessionManager {
  #sessions = new Map(); // token -> WriteSession
  #connect;
  #ttlMs;
  #throttle;
  #sweeper;

  /**
   * @param connect   async ({ user, password }) => mysql2 promise connection
   * @param ttlMs     how long editing stays unlocked after the last change
   * @param throttle  LoginThrottle
   */
  constructor({ connect, ttlMs, throttle }) {
    this.#connect = connect;
    this.#ttlMs = ttlMs;
    this.#throttle = throttle;
    this.#sweeper = setInterval(() => this.#closeExpired(), 30_000);
    this.#sweeper.unref(); // don't keep the process alive just for this timer
  }

  async open({ user, password, client }) {
    if (typeof user !== "string" || !user.trim()) throw new ValidationError("Enter a MySQL username");
    if (typeof password !== "string") throw new ValidationError("Enter the password");
    this.#throttle.check(client);

    let connection;
    try {
      connection = await this.#connect({ user: user.trim(), password });
    } catch (err) {
      if (err.code === "ER_ACCESS_DENIED_ERROR") {
        this.#throttle.fail(client);
        throw new AuthError("Wrong MySQL username or password.");
      }
      if (err.code === "ER_DBACCESS_DENIED_ERROR") {
        this.#throttle.fail(client);
        throw new AuthError(`MySQL user "${user.trim()}" has no access to this database.`);
      }
      throw new AppError(`Cannot connect to MySQL: ${err.message}`, 502);
    }

    this.#throttle.reset(client);
    const session = new WriteSession({
      token: randomBytes(32).toString("base64url"),
      user: user.trim(),
      connection,
      ttlMs: this.#ttlMs,
    });
    this.#sessions.set(session.token, session);
    return session;
  }

  /** Returns the live session for a token, or throws LockedError. Using it extends it. */
  get(token) {
    const session = token ? this.#sessions.get(token) : undefined;
    if (!session || session.closed) {
      if (token) this.#sessions.delete(token);
      throw new LockedError();
    }
    if (session.expired) {
      this.close(token);
      throw new LockedError("Editing was locked after a few minutes without changes. Enter your password again.");
    }
    session.touch();
    return session;
  }

  async close(token) {
    const session = this.#sessions.get(token);
    this.#sessions.delete(token);
    if (session) await session.close();
  }

  async closeAll() {
    clearInterval(this.#sweeper);
    await Promise.all([...this.#sessions.keys()].map((token) => this.close(token)));
  }

  #closeExpired() {
    for (const [token, session] of this.#sessions) {
      if (session.expired || session.closed) this.close(token);
    }
  }
}

module.exports = { WriteSessionManager };
