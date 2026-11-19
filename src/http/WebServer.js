const express = require("express");
const compression = require("compression");
const { AppError, TooManyAttemptsError } = require("../errors");

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const ACCESS_DENIED = new Set([
  "ER_TABLEACCESS_DENIED_ERROR", "ER_COLUMNACCESS_DENIED_ERROR",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR",
]);

/** Builds the Express app (static files, API routes, error handling) and runs it. */
class WebServer {
  #app;
  #port;
  #host;
  #server = null;

  constructor({ port, host, publicDir, controllers }) {
    this.#port = port;
    this.#host = host;
    this.#app = express();
    if (LOOPBACK.has(host)) this.#app.use(WebServer.#localHostOnly);
    this.#app.use(compression()); // gzip responses; table JSON shrinks several times
    this.#app.use(express.json({ limit: "2mb" }));
    this.#app.use(express.static(publicDir));
    for (const controller of controllers) this.#app.use("/api", controller.router);
    this.#app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
    this.#app.use(WebServer.#errorHandler);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.#server = this.#app.listen(this.#port, this.#host, () => resolve(this.#port));
      this.#server.once("error", reject);
    });
  }

  stop() {
    return new Promise((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
  }

  // When listening on localhost only, also refuse requests that name another host.
  // This blocks "DNS rebinding", where a web page tricks the browser into talking to
  // a server on your own computer.
  static #localHostOnly(req, res, next) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (LOOPBACK.has(host)) return next();
    res.status(403).json({ error: "Only local requests are allowed" });
  }

  // AppErrors keep their status. MySQL errors (bad value, foreign key, no permission)
  // are the user's to fix, so they become 4xx with MySQL's own message.
  static #errorHandler(err, req, res, _next) {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON in request body" });
    }
    let status = 500;
    if (err instanceof AppError) status = err.status;
    else if (ACCESS_DENIED.has(err.code)) status = 403;
    else if (err.sqlState?.startsWith("23")) status = 409; // constraint violations
    else if (err.sqlState && err.sqlState !== "HY000" && !err.fatal) status = 400;
    else if (err.sqlMessage && !err.fatal) status = 400;

    if (err instanceof TooManyAttemptsError) res.set("Retry-After", String(err.retryAfterSec));
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.sqlMessage ?? err.message, code: err.code });
  }
}

module.exports = { WebServer };
