import { Component } from "./Component.js";
import { formatCount } from "../utils/format.js";

/**
 * « ‹ [page] of N › »  plus "Rows 251–500 of 2,000,000".
 * Works for the Data and Group views; App decides what each button does.
 */
export class Pager extends Component {
  #root;
  #input;
  #label;
  #range;
  #buttons;

  constructor(deps, root) {
    super(deps);
    this.#root = root;
    root.innerHTML = `
      <span class="range"></span>
      <button type="button" data-go="first" title="First page">«</button>
      <button type="button" data-go="prev" title="Previous page">‹</button>
      <label class="page-input">Page <input type="number" min="1" inputmode="numeric"> <span class="of"></span></label>
      <button type="button" data-go="next" title="Next page">›</button>
      <button type="button" data-go="last" title="Last page">»</button>`;
    this.#input = root.querySelector("input");
    this.#label = root.querySelector(".of");
    this.#range = root.querySelector(".range");
    this.#buttons = Object.fromEntries([...root.querySelectorAll("[data-go]")].map((b) => [b.dataset.go, b]));

    root.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]")?.dataset.go;
      if (go) this.actions[`${go}Page`]();
    });
    // Jump when the user presses Enter or leaves the field.
    this.#input.addEventListener("change", () => this.actions.goToPage(Number(this.#input.value)));
  }

  render(state) {
    const model = Pager.#model(state);
    this.#root.hidden = !model;
    if (!model) return;

    this.#range.textContent = model.range;
    this.#label.textContent = `of ${formatCount(model.totalPages)}`;
    this.#input.max = String(model.totalPages);
    // Don't overwrite the number while the user is typing it.
    if (document.activeElement !== this.#input) this.#input.value = String(model.page);

    this.#buttons.first.disabled = !model.hasPrev;
    this.#buttons.prev.disabled = !model.hasPrev;
    this.#buttons.next.disabled = !model.hasNext;
    this.#buttons.last.disabled = !model.hasNext;
  }

  /** What to show for the active view, or null to hide the pager. */
  static #model(state) {
    const { view, currentTable, error } = state;
    if (error) return null;

    if (view === "data") {
      const data = state.rows;
      if (!data || data.table !== currentTable) return null;
      const start = data.rows.length ? (data.pageNumber - 1) * data.pageSize + 1 : 0;
      const end = data.rows.length ? start + data.rows.length - 1 : 0;
      return {
        page: data.pageNumber,
        totalPages: data.totalPages,
        hasPrev: data.hasPrev,
        hasNext: data.hasNext,
        range: `Rows ${formatCount(start)}–${formatCount(end)} of ${formatCount(data.totalRows)}`,
      };
    }

    if (view === "group") {
      const data = state.groups;
      if (!state.group.column || !data || data.table !== currentTable) return null;
      const start = data.groups.length ? (data.page - 1) * data.pageSize + 1 : 0;
      const end = data.groups.length ? start + data.groups.length - 1 : 0;
      return {
        page: data.page,
        totalPages: data.totalPages,
        hasPrev: data.hasPrev,
        hasNext: data.hasNext,
        range: `Groups ${formatCount(start)}–${formatCount(end)} of ${formatCount(data.totalGroups)}`,
      };
    }

    return null;
  }
}
