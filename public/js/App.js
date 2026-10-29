import { Store } from "./core/Store.js";
import { Poller } from "./core/Poller.js";
import { Toolbar } from "./components/Toolbar.js";
import { TableTabs } from "./components/TableTabs.js";
import { ViewSwitcher } from "./components/ViewSwitcher.js";
import { Pager } from "./components/Pager.js";
import { Notice } from "./components/Notice.js";
import { GroupBar } from "./components/GroupBar.js";
import { ContentArea } from "./components/ContentArea.js";

const INTERVALS = [1000, 2000, 5000, 10000];
const VIEWS = ["data", "group", "structure"];
const FIRST_PAGE = Object.freeze({ page: 1 });
const NO_GROUP = Object.freeze({ column: null, aggregates: [], sortBy: "count", direction: "DESC" });

/**
 * Controller: owns the state, loads data from the API and exposes the actions
 * components call. Components only render; all decisions happen here.
 *
 * Paging: `anchor` says which page of rows to load and is re-sent on every refresh,
 * so the view stays on the same rows while the table changes. `pageNumber` is the page
 * being requested; once rows arrive, `rows.pageNumber` is the page actually shown.
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
      pageSize: saved.pageSize ?? null, // validated once /api/meta tells us the allowed values
      interval: INTERVALS.includes(saved.interval) ? saved.interval : 2000,
      paused: false,

      // data view
      sort: null, // { column, direction: "ASC" | "DESC" }
      anchor: FIRST_PAGE,
      pageNumber: 1,
      rows: null,

      // group view
      group: NO_GROUP,
      groupPage: 1,
      groups: null,

      structure: null,
      error: null,
      updatedAt: null,
    });
    this.#poller = new Poller(() => this.refresh(), this.#store.state.interval);
  }

  mount(el) {
    const deps = { store: this.#store, actions: this };
    new Toolbar(deps, el);
    new TableTabs(deps, el.tabs);
    new ViewSwitcher(deps, el);
    new Pager(deps, el.pager);
    new Notice(deps, el.notice);
    new GroupBar(deps, el.groupbar);
    new ContentArea(deps, el.view);
    return this;
  }

  async start() {
    await this.refresh();
    this.#poller.start();
  }

  get #state() {
    return this.#store.state;
  }

  // ---- general actions ----

  selectTable(name) {
    if (name === this.#state.currentTable) return;
    this.#store.set({
      currentTable: name,
      sort: null, anchor: FIRST_PAGE, pageNumber: 1,
      group: NO_GROUP, groupPage: 1, groups: null,
    });
    this.#prefs.save({ table: name });
    this.refresh();
  }

  setView(view) {
    if (!VIEWS.includes(view) || view === this.#state.view) return;
    this.#store.set({ view });
    this.#prefs.save({ view });
    this.refresh();
  }

  setPageSize(pageSize) {
    this.#store.set({ pageSize, anchor: FIRST_PAGE, pageNumber: 1, groupPage: 1 });
    this.#prefs.save({ pageSize });
    this.refresh();
  }

  setRefreshInterval(ms) {
    this.#store.set({ interval: ms });
    this.#prefs.save({ interval: ms });
    this.#poller.setInterval(ms);
  }

  togglePause() {
    const paused = !this.#state.paused;
    this.#store.set({ paused });
    if (paused) {
      this.#poller.stop();
    } else {
      this.refresh();
      this.#poller.start();
    }
  }

  // ---- data view: sorting ----

  /** Header click: ascending → descending → back to primary-key order. */
  sortBy(column) {
    const { sort } = this.#state;
    let next;
    if (!sort || sort.column !== column) next = { column, direction: "ASC" };
    else if (sort.direction === "ASC") next = { column, direction: "DESC" };
    else next = null;
    this.#store.set({ sort: next, anchor: FIRST_PAGE, pageNumber: 1 });
    this.refresh();
  }

  // ---- paging (works on whichever view is active) ----

  firstPage() {
    this.#state.view === "group" ? this.#goToGroupPage(1) : this.#goTo(FIRST_PAGE, 1);
  }

  lastPage() {
    if (this.#state.view === "group") return this.#goToGroupPage(this.#state.groups?.totalPages ?? 1);
    this.#goTo({ page: "last" }, this.#state.rows?.totalPages ?? 1);
  }

  nextPage() {
    if (this.#state.view === "group") return this.#goToGroupPage(this.#state.groupPage + 1);
    const { rows } = this.#state;
    if (!rows?.hasNext) return;
    // Continue right after the last row shown when cursors are available; otherwise by number.
    const anchor = rows.lastCursor ? { after: rows.lastCursor } : { page: rows.pageNumber + 1 };
    this.#goTo(anchor, rows.pageNumber + 1);
  }

  prevPage() {
    if (this.#state.view === "group") return this.#goToGroupPage(this.#state.groupPage - 1);
    const { rows } = this.#state;
    if (!rows?.hasPrev || rows.pageNumber <= 1) return;
    const anchor = rows.firstCursor ? { before: rows.firstCursor } : { page: rows.pageNumber - 1 };
    this.#goTo(anchor, rows.pageNumber - 1);
  }

  goToPage(number) {
    if (this.#state.view === "group") return this.#goToGroupPage(number);
    const page = App.#clamp(number, this.#state.rows?.totalPages ?? 1);
    this.#goTo(page === 1 ? FIRST_PAGE : { page }, page);
  }

  #goTo(anchor, pageNumber) {
    this.#store.set({ anchor, pageNumber });
    this.refresh();
  }

  #goToGroupPage(number) {
    const page = App.#clamp(number, this.#state.groups?.totalPages ?? 1);
    if (page === this.#state.groupPage) return;
    this.#store.set({ groupPage: page });
    this.refresh();
  }

  static #clamp(number, max) {
    return Math.min(Math.max(1, Math.trunc(number) || 1), Math.max(1, max));
  }

  // ---- group view ----

  setGroupColumn(column) {
    this.#setGroup({ column: column || null, sortBy: "count", direction: "DESC" });
  }

  addAggregate(fn, column) {
    const { aggregates } = this.#state.group;
    if (aggregates.some((a) => a.fn === fn && a.column === column)) return;
    this.#setGroup({ aggregates: [...aggregates, { fn, column }] });
  }

  removeAggregate(index) {
    const { aggregates, sortBy } = this.#state.group;
    const patch = { aggregates: aggregates.filter((_, i) => i !== index) };
    if (typeof sortBy === "number") patch.sortBy = "count"; // aggregate indexes shifted
    this.#setGroup(patch);
  }

  /** Group header click: "group", "count" or an aggregate index. Toggles direction on repeat. */
  sortGroups(field) {
    const { sortBy, direction } = this.#state.group;
    const same = String(sortBy) === String(field);
    const sortKey = field === "group" || field === "count" ? field : Number(field);
    this.#setGroup({
      sortBy: sortKey,
      // Counts and totals read best largest-first; names alphabetically.
      direction: same ? (direction === "ASC" ? "DESC" : "ASC") : sortKey === "group" ? "ASC" : "DESC",
    });
  }

  #setGroup(patch) {
    this.#store.set({ group: { ...this.#state.group, ...patch }, groupPage: 1 });
    this.refresh();
  }

  // ---- data loading ----

  async refresh() {
    const id = ++this.#requestId;
    const isStale = () => id !== this.#requestId;

    try {
      if (!this.#state.meta) await this.#loadMeta();

      const tables = await this.#api.getTables();
      if (isStale()) return;

      const names = tables.map((t) => t.name);
      const patch = { tables };
      let table = this.#state.currentTable;
      if (!names.includes(table)) {
        table = names[0] ?? null;
        Object.assign(patch, {
          currentTable: table,
          sort: null, anchor: FIRST_PAGE, pageNumber: 1,
          group: NO_GROUP, groupPage: 1, groups: null,
        });
      }

      if (table) {
        // Only load what the active view shows: grouping a big table is expensive.
        const state = { ...this.#state, ...patch };
        const [structure, rows, groups] = await Promise.all([
          this.#api.getStructure(table),
          state.view === "data" ? this.#loadRows(table, state) : undefined,
          state.view === "group" && state.group.column ? this.#loadGroups(table, state) : undefined,
        ]);
        patch.structure = structure;
        if (rows) {
          patch.rows = rows;
          patch.pageNumber = rows.pageNumber;
        }
        if (groups) {
          patch.groups = groups;
          patch.groupPage = groups.page;
        }
      }
      if (isStale()) return;

      this.#store.set({ ...patch, error: null, updatedAt: new Date() });
    } catch (err) {
      if (!isStale()) this.#store.set({ error: err.message });
    }
  }

  async #loadRows(table, { pageSize, anchor, sort, pageNumber }) {
    const rows = await this.#api.getRows(table, { size: pageSize, sort, ...anchor });
    // The server knows the number for numbered jumps; cursor pages keep the number we aimed for.
    // The pager shows this, so it only changes together with the rows.
    rows.pageNumber = rows.page ?? (rows.hasPrev ? pageNumber : 1);
    // Identifies the request, so the grid only flashes changes within the same page.
    rows.requestKey = JSON.stringify([table, pageSize, sort, anchor]);
    return rows;
  }

  async #loadGroups(table, { pageSize, group, groupPage }) {
    const groups = await this.#api.getGroups(table, { size: pageSize, page: groupPage, ...group });
    groups.requestKey = JSON.stringify([table, pageSize, group, groupPage]);
    return groups;
  }

  async #loadMeta() {
    const meta = await this.#api.getMeta();
    const { pageSize } = this.#state;
    this.#store.set({
      meta,
      pageSize: meta.pageSizes.includes(pageSize) ? pageSize : meta.defaultPageSize,
    });
  }
}
