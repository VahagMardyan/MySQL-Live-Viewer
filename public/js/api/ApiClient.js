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

  getRows(table, limit) {
    return this.#get(`/tables/${encodeURIComponent(table)}/rows?limit=${limit}`);
  }

  getStructure(table) {
    return this.#get(`/tables/${encodeURIComponent(table)}/structure`);
  }

  async #get(path) {
    let response;
    try {
      response = await fetch(this.#baseUrl + path);
    } catch {
      throw new Error("Cannot reach the server. Is it running?");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }
}
