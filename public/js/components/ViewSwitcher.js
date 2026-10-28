import { Component } from "./Component.js";
import { formatCount, plural } from "../utils/format.js";

/** Data / Structure toggle, plus a one-line summary of what is shown. */
export class ViewSwitcher extends Component {
  #el;

  constructor(deps, elements) {
    super(deps);
    this.#el = elements;
    elements.views.addEventListener("click", (e) => {
      const button = e.target.closest("button[data-view]");
      if (button) this.actions.setView(button.dataset.view);
    });
  }

  render(state) {
    for (const button of this.#el.views.querySelectorAll("button[data-view]")) {
      button.classList.toggle("active", button.dataset.view === state.view);
    }
    this.#el.info.textContent = ViewSwitcher.#summary(state);
  }

  static #summary({ view, currentTable, rows, structure, error }) {
    if (error || !currentTable) return "";

    if (view === "data") {
      if (!rows || rows.table !== currentTable) return "";
      const shown = rows.rows.length;
      return shown < rows.totalRows
        ? `Showing ${formatCount(shown)} of ${plural(rows.totalRows, "row")}`
        : plural(rows.totalRows, "row");
    }

    if (!structure || structure.table !== currentTable) return "";
    return [
      plural(structure.columns.length, "column"),
      plural(structure.foreignKeys.length, "foreign key"),
      plural(structure.uniqueConstraints.length, "unique constraint"),
      plural(structure.checkConstraints.length, "check"),
    ].join(" · ");
  }
}
