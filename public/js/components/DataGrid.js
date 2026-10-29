import { esc } from "../utils/format.js";
import { columnBadges } from "./badges.js";
import { cell } from "./cells.js";

const HIGHLIGHT_MS = 1500;

/**
 * Renders one page of rows. Highlights rows that are new (green) or changed (yellow)
 * since the previous refresh of the same page, and skips the DOM update when nothing
 * changed. Column headers sort the table when clicked (handled by ContentArea).
 */
export class DataGrid {
  #container;
  #previous = new Map(); // row key -> JSON of the row
  #requestKey = null;    // which page the previous rows belong to
  #lastHeader = "";

  constructor(container) {
    this.#container = container;
  }

  render(state, { force = false } = {}) {
    const { rows: data, structure, currentTable } = state;
    if (!data || data.table !== currentTable) {
      this.#show('<div class="empty">Loading…</div>');
      this.#reset();
      return;
    }
    if (!data.rows.length) {
      this.#show(`<div class="empty">${data.totalRows ? "No rows on this page." : `Table <b>${esc(data.table)}</b> is empty.`}</div>`);
      this.#reset();
      return;
    }

    // A different table, page, size or sort is a fresh start: nothing should flash.
    const firstLoad = data.requestKey !== this.#requestKey;
    if (firstLoad) this.#previous = new Map();

    const header = this.#renderHeader(data, structure);
    const keyOf = DataGrid.#keyFunction(data);

    const next = new Map();
    const marks = [];
    for (const [i, row] of data.rows.entries()) {
      const key = keyOf(row, i);
      const json = JSON.stringify(row);
      next.set(key, json);
      if (firstLoad) marks.push("");
      else if (!this.#previous.has(key)) marks.push("new");
      else marks.push(this.#previous.get(key) !== json ? "changed" : "");
    }

    const unchanged =
      !force && !firstLoad && header === this.#lastHeader &&
      next.size === this.#previous.size && marks.every((m) => m === "");
    this.#previous = next;
    this.#requestKey = data.requestKey;
    this.#lastHeader = header;
    if (unchanged) return;

    const body = data.rows
      .map((row, i) => `<tr${marks[i] ? ` class="${marks[i]}"` : ""}>${row.map((v) => cell(v)).join("")}</tr>`)
      .join("");
    this.#show(`<table class="grid"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`);

    if (marks.some(Boolean)) {
      setTimeout(() => {
        for (const tr of this.#container.querySelectorAll("tr.new, tr.changed")) tr.className = "";
      }, HIGHLIGHT_MS);
    }
  }

  #renderHeader(data, structure) {
    const byName = new Map(
      structure && structure.table === data.table ? structure.columns.map((c) => [c.name, c]) : []
    );
    return data.columns
      .map((c) => {
        const sorted = data.sort?.column === c.name;
        const arrow = sorted ? `<span class="arrow">${data.sort.direction === "ASC" ? "▲" : "▼"}</span>` : "";
        const indexed = byName.get(c.name)?.indexed ? "" : " (no index)";
        return `<th class="sortable${sorted ? " sorted" : ""}" data-sort="${esc(c.name)}" title="Sort by ${esc(c.name)}${indexed}">
          <span class="col-name">${esc(c.name)}${columnBadges(byName.get(c.name))}${arrow}</span><small>${esc(c.type)}</small></th>`;
      })
      .join("");
  }

  #show(html) {
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "data";
  }

  #reset() {
    this.#previous = new Map();
    this.#requestKey = null;
    this.#lastHeader = "";
  }

  // Rows are identified by their primary key, so an edited row shows as "changed", not "new".
  static #keyFunction({ columns, primaryKey }) {
    if (!primaryKey.length) return (_row, i) => String(i);
    const indexes = primaryKey.map((name) => columns.findIndex((c) => c.name === name));
    return (row) => JSON.stringify(indexes.map((i) => row[i]));
  }
}
