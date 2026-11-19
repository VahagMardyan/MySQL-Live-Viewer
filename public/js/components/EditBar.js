import { Component } from "./Component.js";
import { formatCount } from "../utils/format.js";

/**
 * Edit buttons above the table. Every button works while locked too: the action
 * asks for the MySQL password first (see WriteAccess).
 */
export class EditBar extends Component {
  #root;
  #last = "";

  constructor(deps, root) {
    super(deps);
    this.#root = root;
    root.addEventListener("click", (e) => {
      const action = e.target.closest("button[data-action]")?.dataset.action;
      if (action) this.actions[action]();
    });
  }

  render(state) {
    const model = EditBar.#model(state);
    this.#root.hidden = !model;
    if (!model) return;

    const signature = JSON.stringify(model);
    if (signature === this.#last) return;
    this.#last = signature;

    const { view, hasKey, selected, autoIncrement } = model;
    const noKey = hasKey ? "" : ' title="This table has no primary key, so rows can\'t be identified" disabled';
    const buttons = [];
    if (view === "data") {
      buttons.push('<button type="button" data-action="addRow">+ Add row</button>');
      buttons.push(`<button type="button" data-action="deleteSelectedRows" class="danger-text"${
        selected ? "" : noKey || ' disabled title="Select rows with the checkboxes first"'}>Delete selected${
        selected ? ` (${formatCount(selected)})` : ""}</button>`);
      if (selected) buttons.push('<button type="button" data-action="clearSelection" class="subtle">Clear selection</button>');
    } else {
      buttons.push('<button type="button" data-action="addColumn">+ Add column</button>');
    }
    buttons.push('<span class="sep"></span>');
    if (autoIncrement) buttons.push('<button type="button" data-action="resetAutoIncrement">Reset AUTO_INCREMENT…</button>');
    this.#root.innerHTML = buttons.join("");
  }

  static #model({ view, currentTable, structure, tables, selected, error }) {
    if (error || (view !== "data" && view !== "structure")) return null;
    if (!structure || structure.table !== currentTable || structure.isView) return null;
    if (!tables.some((t) => t.name === currentTable)) return null;
    return {
      view,
      hasKey: structure.primaryKey.length > 0,
      selected: selected.length,
      autoIncrement: structure.autoIncrement !== null,
    };
  }
}
