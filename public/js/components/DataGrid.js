import { esc } from "../utils/format.js";
import { columnBadges } from "./badges.js";
import { cell } from "./cells.js";
import { rowKeyFunction } from "../utils/rows.js";

const HIGHLIGHT_MS = 1500;

/**
 * Renders one page of rows. Highlights rows that are new (green) or changed (yellow)
 * since the previous refresh of the same page, and skips the DOM update when nothing
 * changed. Tables with a primary key get a checkbox and an edit button per row.
 * Clicks are turned into actions by ContentArea.
 */
export class DataGrid {
  #container;
  #previous = new Map(); // row key -> JSON of the row
  #requestKey = null;    // which page the previous rows belong to
  #lastHeader = "";
  #lastSelection = "";

  constructor(container) {
    this.#container = container;
  }

  render(state, { force = false } = {}) {
    const { rows: data, structure, currentTable, selected } = state;
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

    // Rows can be selected and edited only when a primary key identifies them.
    const editable = data.primaryKey.length > 0 && structure?.table === data.table && !structure.isView;
    const chosen = new Set(selected);
    const selection = selected.join("\n");

    // A different table, page, size or sort is a fresh start: nothing should flash.
    const firstLoad = data.requestKey !== this.#requestKey;
    if (firstLoad) this.#previous = new Map();

    const header = this.#renderHeader(data, structure, editable);
    const keyOf = rowKeyFunction(data);
    const keys = data.rows.map((row, i) => keyOf(row, i));

    const next = new Map();
    const marks = [];
    for (const [i, row] of data.rows.entries()) {
      const json = JSON.stringify(row);
      next.set(keys[i], json);
      if (firstLoad) marks.push("");
      else if (!this.#previous.has(keys[i])) marks.push("new");
      else marks.push(this.#previous.get(keys[i]) !== json ? "changed" : "");
    }

    const unchanged =
      !force && !firstLoad && header === this.#lastHeader &&
      next.size === this.#previous.size && marks.every((m) => m === "");
    this.#previous = next;
    this.#requestKey = data.requestKey;
    this.#lastHeader = header;

    if (unchanged) {
      // Same rows; only the checkboxes may need updating.
      if (selection !== this.#lastSelection) this.#syncCheckboxes(chosen, keys.length);
      this.#lastSelection = selection;
      return;
    }
    this.#lastSelection = selection;

    const body = data.rows
      .map((row, i) => {
        const classes = [marks[i], chosen.has(keys[i]) ? "selected" : ""].filter(Boolean).join(" ");
        const tools = editable
          ? `<td class="row-tools"><input type="checkbox" data-select="${esc(keys[i])}" aria-label="Select row"${
              chosen.has(keys[i]) ? " checked" : ""}><button type="button" class="icon" data-edit="${esc(keys[i])}" title="Edit row">✎</button></td>`
          : "";
        return `<tr${classes ? ` class="${classes}"` : ""}>${tools}${row.map((v) => cell(v)).join("")}</tr>`;
      })
      .join("");
    this.#show(`<table class="grid"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`);
    this.#syncSelectAll(chosen.size, keys.length);

    if (marks.some(Boolean)) {
      setTimeout(() => {
        for (const tr of this.#container.querySelectorAll("tr.new, tr.changed")) {
          tr.classList.remove("new", "changed");
        }
      }, HIGHLIGHT_MS);
    }
  }

  #renderHeader(data, structure, editable) {
    const byName = new Map(
      structure && structure.table === data.table ? structure.columns.map((c) => [c.name, c]) : []
    );
    const selectAll = editable
      ? '<th class="row-tools"><input type="checkbox" data-select-all aria-label="Select all rows on this page"></th>'
      : "";
    return selectAll + data.columns
      .map((c) => {
        const sorted = data.sort?.column === c.name;
        const arrow = sorted ? `<span class="arrow">${data.sort.direction === "ASC" ? "▲" : "▼"}</span>` : "";
        const indexed = byName.get(c.name)?.indexed ? "" : " (no index)";
        return `<th class="sortable${sorted ? " sorted" : ""}" data-sort="${esc(c.name)}" title="Sort by ${esc(c.name)}${indexed}">
          <span class="col-name">${esc(c.name)}${columnBadges(byName.get(c.name))}${arrow}</span><small>${esc(c.type)}</small></th>`;
      })
      .join("");
  }

  #syncCheckboxes(chosen, total) {
    for (const box of this.#container.querySelectorAll("input[data-select]")) {
      box.checked = chosen.has(box.dataset.select);
      box.closest("tr").classList.toggle("selected", box.checked);
    }
    this.#syncSelectAll(chosen.size, total);
  }

  #syncSelectAll(count, total) {
    const all = this.#container.querySelector("input[data-select-all]");
    if (!all) return;
    all.checked = count > 0 && count === total;
    all.indeterminate = count > 0 && count < total;
  }

  #show(html) {
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "data";
  }

  #reset() {
    this.#previous = new Map();
    this.#requestKey = null;
    this.#lastHeader = "";
    this.#lastSelection = "";
  }
}
