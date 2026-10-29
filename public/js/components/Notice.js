import { Component } from "./Component.js";
import { esc, formatCount } from "../utils/format.js";

// Below this many rows a full scan is fast enough not to warn about.
const LARGE_TABLE = 100_000;

/** Performance hints, e.g. sorting or grouping a large table by a column without an index. */
export class Notice extends Component {
  #root;

  constructor(deps, root) {
    super(deps);
    this.#root = root;
  }

  render(state) {
    const message = Notice.#message(state);
    this.#root.hidden = !message;
    this.#root.innerHTML = message ?? "";
  }

  static #message({ view, currentTable, tables, rows, groups, group, error }) {
    if (error) return null;
    const size = tables.find((t) => t.name === currentTable)?.rows ?? 0;
    if (size < LARGE_TABLE) return null;
    const total = formatCount(size);

    if (view === "data" && rows?.table === currentTable && rows.sort && !rows.sortIndexed) {
      return `<b>${esc(rows.sort.column)}</b> has no index, so every refresh sorts all ${total} rows.
        Add an index on it, or pause refreshing while you browse.`;
    }
    if (view === "group" && groups?.table === currentTable && group.column) {
      const age = Math.round((Date.now() - groups.computedAt) / 1000);
      const reason = groups.indexed ? "reads every row" : `reads every row and <b>${esc(group.column)}</b> has no index`;
      const cached = age >= 2 ? ` Showing results from ${age}s ago; slow results are reused for up to 10 seconds.` : "";
      return `Grouping ${reason} (${total} rows).${cached}`;
    }
    return null;
  }
}
