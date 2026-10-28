import { Component } from "./Component.js";
import { esc, formatCount } from "../utils/format.js";

/** One tab per table, with its row count. */
export class TableTabs extends Component {
  #root;

  constructor(deps, root) {
    super(deps);
    this.#root = root;
    // Event delegation: one listener for all tabs, even after re-rendering.
    root.addEventListener("click", (e) => {
      const tab = e.target.closest("button[data-table]");
      if (tab) this.actions.selectTable(tab.dataset.table);
    });
  }

  render(state, patch) {
    if (!("tables" in patch) && !("currentTable" in patch)) return;
    this.#root.innerHTML = state.tables
      .map((t) => {
        const active = t.name === state.currentTable ? ' class="active"' : "";
        const view = t.isView ? '<span class="tag">view</span>' : "";
        return `<button type="button" data-table="${esc(t.name)}"${active}>${esc(t.name)}${view}<span class="count">${formatCount(t.rows)}</span></button>`;
      })
      .join("");
  }
}
