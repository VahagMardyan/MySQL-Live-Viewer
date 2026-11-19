const express = require("express");

const TOKEN_HEADER = "X-Write-Token";

/**
 * Routes that unlock editing and change data or structure.
 * Every change needs a valid write token from POST /auth/unlock.
 */
class EditController {
  #sessions;
  #edits;

  constructor({ sessionManager, editService }) {
    this.#sessions = sessionManager;
    this.#edits = editService;
  }

  get router() {
    const r = express.Router();

    // ---- unlock / lock ----
    r.post("/auth/unlock", this.#handle(async (req) => {
      const { user, password } = req.body ?? {};
      const session = await this.#sessions.open({ user, password, client: req.ip });
      return { token: session.token, user: session.user, ttlMs: session.ttlMs };
    }));
    r.post("/auth/lock", this.#handle(async (req) => {
      await this.#sessions.close(req.get(TOKEN_HEADER));
      return { locked: true };
    }));

    // ---- rows ----
    r.post("/tables/:name/rows", this.#write((s, req) =>
      this.#edits.insertRow(s, req.params.name, req.body?.values)));
    r.patch("/tables/:name/rows", this.#write((s, req) =>
      this.#edits.updateRow(s, req.params.name, req.body ?? {})));
    r.delete("/tables/:name/rows", this.#write((s, req) =>
      this.#edits.deleteRows(s, req.params.name, req.body?.keys)));

    // ---- table ----
    r.post("/tables/:name/truncate", this.#write((s, req) =>
      this.#edits.truncate(s, req.params.name, req.body?.confirm)));
    r.get("/tables/:name/auto-increment", this.#handle((req) =>
      this.#edits.getAutoIncrement(req.params.name)));
    r.post("/tables/:name/auto-increment", this.#write((s, req) =>
      this.#edits.resetAutoIncrement(s, req.params.name, req.body?.value)));

    // ---- columns ----
    r.post("/tables/:name/columns", this.#write((s, req) =>
      this.#edits.addColumn(s, req.params.name, req.body ?? {})));
    r.patch("/tables/:name/columns/:column", this.#write((s, req) =>
      this.#edits.modifyColumn(s, req.params.name, req.params.column, req.body ?? {})));
    r.delete("/tables/:name/columns/:column", this.#write((s, req) =>
      this.#edits.dropColumn(s, req.params.name, req.params.column, req.body?.confirm)));

    return r;
  }

  /** Like #handle, but first looks up the write session (throws LockedError if there is none). */
  #write(action) {
    return this.#handle((req) => action(this.#sessions.get(req.get(TOKEN_HEADER)), req));
  }

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

module.exports = { EditController };
