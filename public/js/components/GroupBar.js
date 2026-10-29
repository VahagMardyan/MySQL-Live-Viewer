import { Component } from "./Component.js";
import { esc } from "../utils/format.js";

const NUMERIC_ONLY = new Set(["sum", "avg"]);
export const FUNCTION_LABELS = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX", count_distinct: "COUNT DISTINCT" };

/**
 * Controls for the Group view: which column to group by, and which aggregates to add.
 * Re-renders only when the columns or the group settings change, so open dropdowns
 * aren't reset by every refresh.
 */
export class GroupBar extends Component {
  #root;
  #signature = "";
  #columns = [];

  constructor(deps, root) {
    super(deps);
    this.#root = root;

    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-role=by]")) this.actions.setGroupColumn(e.target.value);
      if (e.target.matches("[data-role=fn]")) this.#fillColumnOptions();
    });
    root.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove]");
      if (remove) this.actions.removeAggregate(Number(remove.dataset.remove));
      if (e.target.closest("[data-role=add]")) {
        const fn = root.querySelector("[data-role=fn]").value;
        const column = root.querySelector("[data-role=col]").value;
        if (fn && column) this.actions.addAggregate(fn, column);
      }
    });
  }

  render(state) {
    const { view, structure, currentTable, group, meta } = state;
    const visible = view === "group" && structure?.table === currentTable && !state.error;
    this.#root.hidden = !visible;
    if (!visible) return;

    const signature = JSON.stringify([structure.columns.map((c) => [c.name, c.numeric]), group, meta?.aggregateFunctions]);
    if (signature === this.#signature) return;
    this.#signature = signature;

    const columns = structure.columns;
    const byOptions = columns
      .map((c) => `<option value="${esc(c.name)}"${c.name === group.column ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
    const fnOptions = (meta?.aggregateFunctions ?? Object.keys(FUNCTION_LABELS))
      .map((fn) => `<option value="${fn}">${FUNCTION_LABELS[fn] ?? fn}</option>`)
      .join("");
    const chips = group.aggregates
      .map((a, i) => `<span class="chip">${FUNCTION_LABELS[a.fn]}(${esc(a.column)})<button type="button" data-remove="${i}" title="Remove">×</button></span>`)
      .join("");

    this.#root.innerHTML = `
      <label>Group by
        <select data-role="by">
          <option value=""${group.column ? "" : " selected"}>Choose a column…</option>
          ${byOptions}
        </select>
      </label>
      ${group.column ? `
        <span class="sep"></span>
        <label>Add
          <select data-role="fn">${fnOptions}</select>
        </label>
        <label>of <select data-role="col"></select></label>
        <button type="button" data-role="add">Add</button>
        ${chips}` : ""}`;
    this.#columns = columns;
    if (group.column) this.#fillColumnOptions();
  }

  // SUM and AVG only make sense for numbers, so they only offer numeric columns.
  #fillColumnOptions() {
    const fn = this.#root.querySelector("[data-role=fn]").value;
    const select = this.#root.querySelector("[data-role=col]");
    const allowed = this.#columns.filter((c) => !NUMERIC_ONLY.has(fn) || c.numeric);
    select.innerHTML = allowed.length
      ? allowed.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")
      : '<option value="">no numeric columns</option>';
  }
}
