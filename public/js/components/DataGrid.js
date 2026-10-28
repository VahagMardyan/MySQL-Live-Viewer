import { esc } from "../utils/format.js";
import { columnBadges } from "./badges.js";

const HIGHLIGHT_MS = 1500;

/**
 * Renders table rows and highlights rows that are new (green) or changed (yellow)
 * since the previous refresh. Skips the DOM update when nothing changed.
 */
export class DataGrid {
  #container;
  #previous = new Map(); // row key -> JSON of the row
  #context = null;       // "table|limit" the previous rows belong to
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
      this.#show(`<div class="empty">Table <b>${esc(data.table)}</b> is empty.</div>`);
      this.#reset();
      return;
    }

    // A different table or limit is a fresh start: nothing should flash.
    const context = `${data.table}|${data.limit}`;
    const firstLoad = context !== this.#context;
    if (firstLoad) this.#previous = new Map();

    const header = this.#renderHeader(data, structure);
    const keyOf = DataGrid.#keyFunction(data.primaryKey);

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
    this.#context = context;
    this.#lastHeader = header;
    if (unchanged) return;

    const body = data.rows
      .map((row, i) => {
        const cls = marks[i] ? ` class="${marks[i]}"` : "";
        const cells = data.columns.map((c) => DataGrid.#cell(row[c.name])).join("");
        return `<tr${cls}>${cells}</tr>`;
      })
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
      .map((c) => `<th><span class="col-name">${esc(c.name)}${columnBadges(byName.get(c.name))}</span><small>${esc(c.type)}</small></th>`)
      .join("");
  }

  #show(html) {
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "data";
  }

  #reset() {
    this.#previous = new Map();
    this.#context = null;
    this.#lastHeader = "";
  }

  static #keyFunction(primaryKey) {
    if (!primaryKey.length) return (_row, i) => String(i);
    return (row) => JSON.stringify(primaryKey.map((col) => row[col]));
  }

  static #cell(value) {
    if (value === null || value === undefined) return '<td class="null">NULL</td>';
    let text;
    if (typeof value === "object") {
      // Binary columns arrive as serialized Buffers; JSON columns as objects.
      text = value.type === "Buffer" && Array.isArray(value.data)
        ? `<binary ${value.data.length} bytes>`
        : JSON.stringify(value);
    } else {
      text = String(value);
    }
    const safe = esc(text);
    return `<td title="${safe}">${safe}</td>`;
  }
}
