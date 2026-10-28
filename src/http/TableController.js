const express = require("express");

/** Maps HTTP requests to TableService calls. Errors go to the error middleware. */
class TableController {
  #service;
  #meta;

  constructor({ tableService, meta }) {
    this.#service = tableService;
    this.#meta = meta;
  }

  get router() {
    const router = express.Router();
    router.get("/meta", this.#handle(() => this.#meta));
    router.get("/tables", this.#handle(() => this.#service.listTables()));
    router.get("/tables/:name/rows", this.#handle((req) =>
      this.#service.getRows(req.params.name, req.query.limit)
    ));
    router.get("/tables/:name/structure", this.#handle((req) =>
      this.#service.getStructure(req.params.name)
    ));
    return router;
  }

  /** Wraps an async action: sends its result as JSON, forwards errors to next(). */
  #handle(action) {
    return async (req, res, next) => {
      try {
        res.json(await action(req));
      } catch (err) {
        next(err);
      }
    };
  }
}

module.exports = { TableController };
