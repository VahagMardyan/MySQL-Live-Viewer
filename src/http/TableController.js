const express = require("express");

/** Maps HTTP requests to TableService calls. Errors go to the error middleware. */
class TableController {
  #service;
  #groups;
  #meta;

  constructor({ tableService, groupService, meta }) {
    this.#service = tableService;
    this.#groups = groupService;
    this.#meta = meta;
  }

  get router() {
    const router = express.Router();
    router.get("/meta", this.#handle(() => this.#meta));
    router.get("/tables", this.#handle(() => this.#service.listTables()));
    // ?size=250&sort=col&dir=asc plus one of: page=N, page=last, after=<cursor>, before=<cursor>
    router.get("/tables/:name/rows", this.#handle((req) => {
      const { size, page, after, before, sort, dir } = req.query;
      return this.#service.getRows(req.params.name, { size, page, after, before, sort, dir });
    }));
    // ?by=col&agg=sum:amount,avg:amount&sort=count&dir=desc&size=250&page=1
    router.get("/tables/:name/groups", this.#handle((req) => {
      const { by, agg, sort, dir, size, page } = req.query;
      return this.#groups.getGroups(req.params.name, { by, agg, sort, dir, size, page });
    }));
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
