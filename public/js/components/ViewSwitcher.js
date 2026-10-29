import { Component } from "./Component.js";
import { plural } from "../utils/format.js";

/** Data / Group / Structure toggle, plus a summary line for the Structure view. */
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

  // Data and Group views show their counts in the pager instead.
  static #summary({ view, currentTable, structure, error }) {
    if (error || view !== "structure" || !structure || structure.table !== currentTable) return "";
    return [
      plural(structure.columns.length, "column"),
      plural(structure.foreignKeys.length, "foreign key"),
      plural(structure.uniqueConstraints.length, "unique constraint"),
      plural(structure.checkConstraints.length, "check"),
    ].join(" · ");
  }
}
