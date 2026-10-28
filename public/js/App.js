import { Store } from "./core/Store.js";
import { Poller } from "./core/Poller.js";
import { Toolbar } from "./components/Toolbar.js";
import { TableTabs } from "./components/TableTabs.js";
import { ViewSwitcher } from "./components/ViewSwitcher.js";
import { ContentArea } from "./components/ContentArea.js";

const INTERVALS = [1000, 2000, 5000, 10000];
const VIEWS = ["data", "structure"];

/**
 * Controller: owns the state, loads data from the API and exposes the actions
 * components call. Components only render; all decisions happen here.
 */
export class App {
  #api;
  #prefs;
  #store;
  #poller;
  #requestId = 0; // used to ignore responses that arrive after a newer request

  constructor({ api, preferences }) {
    this.#api = api;
    this.#prefs = preferences;

    const saved = preferences.load();
    this.#store = new Store({
      meta: null,
      tables: [],
      currentTable: saved.table ?? null,
      view: VIEWS.includes(saved.view) ? saved.view : "data",
      limit: saved.limit ?? null, // validated once /api/meta tells us the allowed values
      interval: INTERVALS.includes(saved.interval) ? saved.interval : 2000,
      paused: false,
      rows: null,
      structure: null,
      error: null,
      updatedAt: null,
    });
    this.#poller = new Poller(() => this.refresh(), this.#store.state.interval);
  }

  mount(elements) {
    const deps = { store: this.#store, actions: this };
    new Toolbar(deps, elements);
    new TableTabs(deps, elements.tabs);
    new ViewSwitcher(deps, elements);
    new ContentArea(deps, elements.view);
    return this;
  }

  async start() {
    await this.refresh();
    this.#poller.start();
  }

  // ---- actions (called by components) ----

  selectTable(name) {
    if (name === this.#store.state.currentTable) return;
    this.#store.set({ currentTable: name });
    this.#prefs.save({ table: name });
    this.refresh();
  }

  setView(view) {
    if (!VIEWS.includes(view)) return;
    this.#store.set({ view });
    this.#prefs.save({ view });
  }

  setLimit(limit) {
    this.#store.set({ limit });
    this.#prefs.save({ limit });
    this.refresh();
  }

  setRefreshInterval(ms) {
    this.#store.set({ interval: ms });
    this.#prefs.save({ interval: ms });
    this.#poller.setInterval(ms);
  }

  togglePause() {
    const paused = !this.#store.state.paused;
    this.#store.set({ paused });
    if (paused) {
      this.#poller.stop();
    } else {
      this.refresh();
      this.#poller.start();
    }
  }

  // ---- data loading ----

  async refresh() {
    const id = ++this.#requestId;
    const isStale = () => id !== this.#requestId;

    try {
      if (!this.#store.state.meta) await this.#loadMeta();

      const tables = await this.#api.getTables();
      if (isStale()) return;

      const names = tables.map((t) => t.name);
      let { currentTable } = this.#store.state;
      if (!names.includes(currentTable)) currentTable = names[0] ?? null;

      let rows = null;
      let structure = null;
      if (currentTable) {
        [rows, structure] = await Promise.all([
          this.#api.getRows(currentTable, this.#store.state.limit),
          this.#api.getStructure(currentTable),
        ]);
      }
      if (isStale()) return;

      this.#store.set({ tables, currentTable, rows, structure, error: null, updatedAt: new Date() });
    } catch (err) {
      if (!isStale()) this.#store.set({ error: err.message });
    }
  }

  async #loadMeta() {
    const meta = await this.#api.getMeta();
    const { limit } = this.#store.state;
    this.#store.set({
      meta,
      limit: meta.rowLimits.includes(limit) ? limit : meta.defaultRowLimit,
    });
  }
}
