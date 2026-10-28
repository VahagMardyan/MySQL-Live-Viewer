import { Component } from "./Component.js";
import { DataGrid } from "./DataGrid.js";
import { StructurePanel } from "./StructurePanel.js";
import { esc } from "../utils/format.js";

/**
 * Main panel. Delegates to the DataGrid or StructurePanel depending on the
 * selected view, and shows errors and empty-database messages itself.
 */
export class ContentArea extends Component {
  #container;
  #views;

  constructor(deps, container) {
    super(deps);
    this.#container = container;
    this.#views = {
      data: new DataGrid(container),
      structure: new StructurePanel(container),
    };
    container.addEventListener("click", (e) => {
      const link = e.target.closest("[data-goto]");
      if (link) this.actions.selectTable(link.dataset.goto);
    });
  }

  render(state) {
    if (state.error) {
      this.#show(`<div class="error">${esc(state.error)}</div>`);
      return;
    }
    if (state.meta && !state.tables.length) {
      this.#show('<div class="empty">No tables in this database.</div>');
      return;
    }
    // Force a full render when the container was last drawn by something else.
    const force = this.#container.dataset.owner !== state.view;
    this.#views[state.view].render(state, { force });
  }

  #show(html) {
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "message";
  }
}
