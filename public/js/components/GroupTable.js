import { esc, formatCount } from "../utils/format.js";
import { FUNCTION_LABELS } from "./GroupBar.js";
import { cell } from "./cells.js";

/** Results of the Group view: one row per group, with clickable headers to sort. */
export class GroupTable {
  #container;
  #last = "";

  constructor(container) {
    this.#container = container;
  }

  render(state, { force = false } = {}) {
    const { groups: data, group, currentTable } = state;
    if (!group.column) {
      this.#show('<div class="empty">Choose a column to group by.</div>');
      return;
    }
    if (!data || data.table !== currentTable || data.column.name !== group.column) {
      this.#show('<div class="empty">Grouping…</div>');
      return;
    }
    if (!data.groups.length) {
      this.#show('<div class="empty">No rows to group.</div>');
      return;
    }

    const signature = JSON.stringify([data.groups, data.sortBy, data.direction, data.aggregates]);
    if (!force && signature === this.#last) return;
    this.#last = signature;

    const header = (field, label, sub) => {
      const active = String(data.sortBy) === String(field);
      const arrow = active ? (data.direction === "ASC" ? " ▲" : " ▼") : "";
      return `<th class="sortable${active ? " sorted" : ""}" data-group-sort="${field}">${label}${arrow}${sub ? `<small>${sub}</small>` : ""}</th>`;
    };

    const heads = [
      header("group", esc(data.column.name), esc(data.column.type)),
      header("count", "Rows", "COUNT(*)"),
      ...data.aggregates.map((a, i) => header(i, `${FUNCTION_LABELS[a.fn]}(${esc(a.column)})`, "")),
    ].join("");

    const body = data.groups
      .map(([value, count, ...aggs]) =>
        `<tr>${cell(value)}<td class="num">${formatCount(count)}</td>${aggs.map((v) => cell(v, "num")).join("")}</tr>`)
      .join("");

    this.#show(`<table class="grid"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`);
  }

  #show(html) {
    if (html.startsWith('<div')) this.#last = "";
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "group";
  }
}
