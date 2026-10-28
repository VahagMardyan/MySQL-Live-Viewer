const express = require("express");
const { AppError } = require("../errors");

/** Builds the Express app (static files, API routes, error handling) and runs it. */
class WebServer {
  #app;
  #port;
  #server = null;

  constructor({ port, publicDir, controllers }) {
    this.#port = port;
    this.#app = express();
    this.#app.use(express.static(publicDir));
    for (const controller of controllers) this.#app.use("/api", controller.router);
    this.#app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
    this.#app.use(WebServer.#errorHandler);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.#server = this.#app.listen(this.#port, () => resolve(this.#port));
      this.#server.once("error", reject);
    });
  }

  stop() {
    return new Promise((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
  }

  // Known AppErrors keep their status; database errors become 500 with the MySQL message.
  static #errorHandler(err, req, res, _next) {
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message });
  }
}

module.exports = { WebServer };
