/** Talks to the backend. All other modules use this class instead of fetch(). */
export class ApiClient {
  #baseUrl;

  constructor(baseUrl = "/api") {
    this.#baseUrl = baseUrl;
  }

  getMeta() {
    return this.#get("/meta");
  }

  getTables() {
    return this.#get("/tables");
  }

  /**
   * @param size   rows per page
   * @param sort   { column, direction } or null
   * @param page | after | before   which page: a number or "last", or a cursor
   */
  getRows(table, { size, sort, page, after, before }) {
    return this.#get(`/tables/${encodeURIComponent(table)}/rows`, {
      size,
      sort: sort?.column,
      dir: sort?.direction.toLowerCase(),
      page,
      after,
      before,
    });
  }

  /** @param aggregates [{ fn, column }] */
  getGroups(table, { size, page, column, aggregates, sortBy, direction }) {
    return this.#get(`/tables/${encodeURIComponent(table)}/groups`, {
      by: column,
      agg: aggregates.map((a) => `${a.fn}:${a.column}`).join(","),
      sort: sortBy,
      dir: direction.toLowerCase(),
      size,
      page,
    });
  }

  getStructure(table) {
    return this.#get(`/tables/${encodeURIComponent(table)}/structure`);
  }

  async #get(path, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const url = this.#baseUrl + path + (params.size ? `?${params}` : "");

    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error("Cannot reach the server. Is it running?");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }
}
