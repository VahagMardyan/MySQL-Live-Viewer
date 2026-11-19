import { Component } from "./Component.js";
import { DataGrid } from "./DataGrid.js";
import { GroupTable } from "./GroupTable.js";
import { StructurePanel } from "./StructurePanel.js";
import { esc } from "../utils/format.js";

/**
 * Main panel. Delegates to DataGrid, GroupTable or StructurePanel depending on the
 * selected view, shows errors itself, and turns clicks into App actions.
 */
export class ContentArea extends Component {
  #container;
  #views;

  constructor(deps, container) {
    super(deps);
    this.#container = container;
    this.#views = {
      data: new DataGrid(container),
      group: new GroupTable(container),
      structure: new StructurePanel(container),
    };

    // One delegated listener for every clickable thing inside the panel.
    container.addEventListener("click", (e) => {
      if (e.target.matches("input[type=checkbox]")) return; // handled by "change" below
      const target = e.target.closest(
        "[data-goto], [data-edit], [data-edit-column], [data-drop-column], [data-sort], [data-group-sort]"
      );
      if (!target) return;
      const d = target.dataset;
      if (d.goto) this.actions.selectTable(d.goto);
      else if (d.edit) this.actions.editRow(d.edit);
      else if (d.editColumn) this.actions.editColumn(d.editColumn);
      else if (d.dropColumn) this.actions.dropColumn(d.dropColumn);
      else if (d.sort) this.actions.sortBy(d.sort);
      else this.actions.sortGroups(d.groupSort);
    });

    // Row checkboxes.
    container.addEventListener("change", (e) => {
      if (e.target.matches("input[data-select-all]")) this.actions.toggleAllRows(e.target.checked);
      else if (e.target.matches("input[data-select]")) this.actions.toggleRow(e.target.dataset.select, e.target.checked);
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
