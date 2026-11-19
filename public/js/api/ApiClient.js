/** An error from the API, with the HTTP status and the server's short `code` (e.g. "locked"). */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Talks to the backend. All other modules use this class instead of fetch().
 * It also holds the write token while editing is unlocked. The token is kept
 * only in memory, never in localStorage, so closing or reloading the page locks editing.
 */
export class ApiClient {
  #baseUrl;
  #writeToken = null;

  constructor(baseUrl = "/api") {
    this.#baseUrl = baseUrl;
  }

  // ---------------------------------------------------------------- reading

  getMeta() {
    return this.#request("GET", "/meta");
  }

  getTables() {
    return this.#request("GET", "/tables");
  }

  /**
   * @param size   rows per page
   * @param sort   { column, direction } or null
   * @param page | after | before   which page: a number or "last", or a cursor
   */
  getRows(table, { size, sort, page, after, before }) {
    return this.#request("GET", `${this.#table(table)}/rows`, {
      query: { size, sort: sort?.column, dir: sort?.direction.toLowerCase(), page, after, before },
    });
  }

  /** @param aggregates [{ fn, column }] */
  getGroups(table, { size, page, column, aggregates, sortBy, direction }) {
    return this.#request("GET", `${this.#table(table)}/groups`, {
      query: {
        by: column,
        agg: aggregates.map((a) => `${a.fn}:${a.column}`).join(","),
        sort: sortBy,
        dir: direction.toLowerCase(),
        size,
        page,
      },
    });
  }

  getStructure(table) {
    return this.#request("GET", `${this.#table(table)}/structure`);
  }

  getAutoIncrement(table) {
    return this.#request("GET", `${this.#table(table)}/auto-increment`);
  }

  // ---------------------------------------------------------------- editing

  get hasWriteToken() {
    return this.#writeToken !== null;
  }

  clearWriteToken() {
    this.#writeToken = null;
  }

  /** Checks the MySQL user and password; on success, later changes are sent with the token. */
  async unlock(user, password) {
    const session = await this.#request("POST", "/auth/unlock", { body: { user, password } });
    this.#writeToken = session.token;
    return { user: session.user, ttlMs: session.ttlMs };
  }

  async lock() {
    try {
      await this.#request("POST", "/auth/lock", { write: true });
    } finally {
      this.#writeToken = null;
    }
  }

  insertRow(table, values) {
    return this.#request("POST", `${this.#table(table)}/rows`, { body: { values }, write: true });
  }

  updateRow(table, { key, original, changes }) {
    return this.#request("PATCH", `${this.#table(table)}/rows`, { body: { key, original, changes }, write: true });
  }

  deleteRows(table, keys) {
    return this.#request("DELETE", `${this.#table(table)}/rows`, { body: { keys }, write: true });
  }

  truncate(table, confirm) {
    return this.#request("POST", `${this.#table(table)}/truncate`, { body: { confirm }, write: true });
  }

  resetAutoIncrement(table, value) {
    return this.#request("POST", `${this.#table(table)}/auto-increment`, { body: { value }, write: true });
  }

  addColumn(table, { column, position }) {
    return this.#request("POST", `${this.#table(table)}/columns`, { body: { column, position }, write: true });
  }

  modifyColumn(table, name, { column, position }) {
    return this.#request("PATCH", `${this.#table(table)}/columns/${encodeURIComponent(name)}`, {
      body: { column, position },
      write: true,
    });
  }

  dropColumn(table, name, confirm) {
    return this.#request("DELETE", `${this.#table(table)}/columns/${encodeURIComponent(name)}`, {
      body: { confirm },
      write: true,
    });
  }

  // ---------------------------------------------------------------- transport

  #table(name) {
    return `/tables/${encodeURIComponent(name)}`;
  }

  async #request(method, path, { query = {}, body, write = false } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const url = this.#baseUrl + path + (params.size ? `?${params}` : "");

    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (write && this.#writeToken) headers["X-Write-Token"] = this.#writeToken;

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("Cannot reach the server. Is it running?", 0, "network");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.code === "locked") this.#writeToken = null;
      throw new ApiError(data.error || `${response.status} ${response.statusText}`, response.status, data.code);
    }
    return data;
  }
}
