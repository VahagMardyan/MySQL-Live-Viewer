import { Store } from "./core/Store.js";
import { Poller } from "./core/Poller.js";
import { Toolbar } from "./components/Toolbar.js";
import { TableTabs } from "./components/TableTabs.js";
import { ViewSwitcher } from "./components/ViewSwitcher.js";
import { Pager } from "./components/Pager.js";
import { Notice } from "./components/Notice.js";
import { GroupBar } from "./components/GroupBar.js";
import { ContentArea } from "./components/ContentArea.js";
import { EditBar } from "./components/EditBar.js";
import { WriteAccess } from "./services/WriteAccess.js";
import { openModal, confirmDialog, isModalOpen, CancelledError } from "./ui/Modal.js";
import { rowEditor, columnEditor } from "./ui/editors.js";
import { showToast } from "./ui/toast.js";
import { rowKeyFunction, rowObject, rowKeyObject } from "./utils/rows.js";
import { esc, formatCount, plural } from "./utils/format.js";

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
  #write;
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

      // editing
      selected: [], // row keys (JSON of primary-key values) checked on the current page
      write: null,  // { user, expiresAt } while editing is unlocked
    });
    this.#write = new WriteAccess({ api, store: this.#store });
    // Auto-refresh pauses while a dialog is open, so the table doesn't change under an edit.
    this.#poller = new Poller(() => (isModalOpen() ? undefined : this.refresh()), this.#store.state.interval);
  }

  mount(el) {
    const deps = { store: this.#store, actions: this };
    new Toolbar(deps, el);
    new TableTabs(deps, el.tabs);
    new ViewSwitcher(deps, el);
    new Pager(deps, el.pager);
    new Notice(deps, el.notice);
    new GroupBar(deps, el.groupbar);
    new EditBar(deps, el.editbar);
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
      selected: [],
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
    this.#store.set({ pageSize, anchor: FIRST_PAGE, pageNumber: 1, groupPage: 1, selected: [] });
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
    this.#store.set({ sort: next, anchor: FIRST_PAGE, pageNumber: 1, selected: [] });
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
    this.#store.set({ anchor, pageNumber, selected: [] });
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

  // ---- selection ----

  toggleRow(key, checked) {
    const selected = this.#state.selected.filter((k) => k !== key);
    if (checked) selected.push(key);
    this.#store.set({ selected });
  }

  toggleAllRows(checked) {
    const { rows } = this.#state;
    if (!rows) return;
    const keyOf = rowKeyFunction(rows);
    this.#store.set({ selected: checked ? rows.rows.map((r, i) => keyOf(r, i)) : [] });
  }

  clearSelection() {
    this.#store.set({ selected: [] });
  }

  // ---- editing: lock ----

  async toggleLock() {
    if (this.#write.unlocked) {
      await this.#write.lock();
      showToast("Editing locked");
      return;
    }
    try {
      const session = await this.#write.unlock();
      showToast(`Editing unlocked as ${session.user}`);
    } catch (err) {
      if (!(err instanceof CancelledError)) showToast(err.message, "error");
    }
  }

  // ---- editing: rows ----

  async addRow() {
    const { currentTable: table, structure } = this.#state;
    const editor = rowEditor(structure);
    const result = await openModal({
      title: `Add row to ${table}`,
      submitLabel: "Add row",
      wide: true,
      body: editor.body,
      onMount: (form) => editor.mount(form),
      onSubmit: (form) => this.#write.run(() => this.#api.insertRow(table, editor.read(form).values)),
    });
    if (result) this.#changed(result.insertId ? `Row added (id ${result.insertId})` : "Row added");
  }

  async editRow(key) {
    const { currentTable: table, structure, rows } = this.#state;
    const keyOf = rowKeyFunction(rows);
    const row = rows.rows.find((r, i) => keyOf(r, i) === key);
    if (!row) return;
    const editor = rowEditor(structure, rowObject(rows, row));
    const result = await openModal({
      title: `Edit row in ${table}`,
      submitLabel: "Save changes",
      wide: true,
      body: editor.body,
      onMount: (form) => editor.mount(form),
      onSubmit: async (form) => {
        const { changes, original } = editor.read(form);
        if (!Object.keys(changes).length) return "unchanged";
        return this.#write.run(() =>
          this.#api.updateRow(table, { key: rowKeyObject(rows, row), original, changes }));
      },
    });
    if (result === "unchanged") showToast("Nothing was changed");
    else if (result) this.#changed("Row saved");
  }

  async deleteSelectedRows() {
    const { currentTable: table, rows, selected } = this.#state;
    if (!rows || !selected.length) return;
    const keyOf = rowKeyFunction(rows);
    const keys = rows.rows
      .filter((r, i) => selected.includes(keyOf(r, i)))
      .map((r) => rowKeyObject(rows, r));

    const result = await confirmDialog({
      title: `Delete ${plural(keys.length, "row")}?`,
      message: `<p>${plural(keys.length, "row")} will be deleted from <b>${esc(table)}</b>. This can't be undone.</p>
        <p class="muted">If other tables reference these rows through a foreign key, MySQL refuses the
        delete (or also deletes the referencing rows, if the key is ON DELETE CASCADE).</p>`,
      confirmLabel: `Delete ${plural(keys.length, "row")}`,
      onConfirm: () => this.#write.run(() => this.#api.deleteRows(table, keys)),
    });
    if (result) {
      this.#store.set({ selected: [] });
      this.#changed(`Deleted ${plural(result.deleted, "row")}`);
    }
  }

  // ---- editing: table ----

  async truncateTable() {
    const { currentTable: table, tables } = this.#state;
    const info = tables.find((t) => t.name === table);
    const count = info ? `${info.exact ? "" : "about "}${formatCount(info.rows)}` : "all";
    const result = await confirmDialog({
      title: `Truncate ${table}?`,
      message: `<p>This deletes <b>all ${count} rows</b> of <b>${esc(table)}</b> at once and resets
        AUTO_INCREMENT to 1. It can't be undone.</p>
        <p class="muted">MySQL refuses if another table has a foreign key pointing to this one.</p>`,
      confirmLabel: "Truncate table",
      typeToConfirm: table,
      onConfirm: (form) => this.#write.run(() => this.#api.truncate(table, form.elements.confirm.value)),
    });
    if (result) {
      this.#store.set({ selected: [], anchor: FIRST_PAGE, pageNumber: 1 });
      this.#changed(`${table} truncated`);
    }
  }

  async resetAutoIncrement() {
    const { currentTable: table } = this.#state;
    let info;
    try {
      info = await this.#api.getAutoIncrement(table);
    } catch (err) {
      showToast(err.message, "error");
      return;
    }
    const result = await openModal({
      title: `Reset AUTO_INCREMENT of ${table}`,
      submitLabel: "Set value",
      body: `
        <dl class="facts">
          <dt>Column</dt><dd><code>${esc(info.column)}</code></dd>
          <dt>Next value now</dt><dd>${esc(info.next)}</dd>
          <dt>Highest value in table</dt><dd>${info.max === null ? '<span class="muted">table is empty</span>' : esc(info.max)}</dd>
        </dl>
        <label class="radio"><input type="radio" name="mode" value="lowest" checked>
          Reset to the lowest possible value: <b>${esc(info.lowest)}</b></label>
        <label class="radio"><input type="radio" name="mode" value="custom">
          Set to <input name="value" inputmode="numeric" class="short" value="${esc(info.lowest)}" disabled></label>
        <p class="modal-note">MySQL never sets it below the highest value + 1 (${esc(info.lowest)}).
          A lower number is raised to that.</p>`,
      onMount: (form) => {
        form.addEventListener("change", () => {
          form.elements.value.disabled = form.elements.mode.value !== "custom";
        });
      },
      onSubmit: (form) => {
        const value = form.elements.mode.value === "custom" ? form.elements.value.value.trim() : undefined;
        return this.#write.run(() => this.#api.resetAutoIncrement(table, value));
      },
    });
    if (result) {
      this.#changed(`Next AUTO_INCREMENT value is ${result.next}${result.raised ? " (raised to the lowest possible)" : ""}`);
    }
  }

  // ---- editing: columns ----

  async addColumn() {
    const { currentTable: table, structure } = this.#state;
    const editor = columnEditor(structure);
    const result = await openModal({
      title: `Add column to ${table}`,
      submitLabel: "Add column",
      wide: true,
      body: editor.body,
      onMount: (form) => editor.mount(form),
      onSubmit: (form) => this.#write.run(() => this.#api.addColumn(table, editor.read(form))),
    });
    if (result) this.#changed(`Column ${result.added} added`);
  }

  async editColumn(name) {
    const { currentTable: table, structure, tables } = this.#state;
    const column = structure.columns.find((c) => c.name === name);
    if (!column) return;
    if (column.generated) {
      showToast("Generated columns can't be changed here", "error");
      return;
    }
    const largeTable = (tables.find((t) => t.name === table)?.rows ?? 0) > 100_000;
    const editor = columnEditor(structure, column, { largeTable });
    const result = await openModal({
      title: `Change column ${name}`,
      submitLabel: "Save column",
      wide: true,
      body: editor.body,
      onMount: (form) => editor.mount(form),
      onSubmit: (form) => this.#write.run(() => this.#api.modifyColumn(table, name, editor.read(form))),
    });
    if (result) this.#changed(`Column ${result.modified} saved`);
  }

  async dropColumn(name) {
    const { currentTable: table } = this.#state;
    const result = await confirmDialog({
      title: `Drop column ${name}?`,
      message: `<p>The column <b>${esc(name)}</b> and all its values will be removed from
        <b>${esc(table)}</b>. This can't be undone.</p>`,
      confirmLabel: "Drop column",
      typeToConfirm: name,
      onConfirm: (form) => this.#write.run(() => this.#api.dropColumn(table, name, form.elements.confirm.value)),
    });
    if (result) this.#changed(`Column ${name} dropped`);
  }

  /** After a successful change: tell the user and reload right away. */
  #changed(message) {
    showToast(message);
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
          // Keep only selected rows that are still on the page (others were deleted).
          const keyOf = rowKeyFunction(rows);
          const present = new Set(rows.rows.map((r, i) => keyOf(r, i)));
          const kept = this.#state.selected.filter((k) => present.has(k));
          if (kept.length !== this.#state.selected.length) patch.selected = kept;
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
