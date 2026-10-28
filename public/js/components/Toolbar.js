import { Component } from "./Component.js";
import { formatCount } from "../utils/format.js";

/** Header controls: database name, status dot, row limit, refresh interval, pause. */
export class Toolbar extends Component {
  #el;

  constructor(deps, elements) {
    super(deps);
    this.#el = elements;
    this.#el.limit.addEventListener("change", (e) => this.actions.setLimit(Number(e.target.value)));
    this.#el.interval.addEventListener("change", (e) => this.actions.setRefreshInterval(Number(e.target.value)));
    this.#el.pause.addEventListener("click", () => this.actions.togglePause());
  }

  render(state, patch) {
    const { db, status, dot, limit, interval, pause } = this.#el;

    if ("meta" in patch && state.meta) {
      db.textContent = `· ${state.meta.database}`;
      db.title = state.meta.server;
      limit.innerHTML = state.meta.rowLimits
        .map((n) => `<option value="${n}">${formatCount(n)}</option>`)
        .join("");
    }

    Toolbar.#syncValue(limit, state.limit);
    Toolbar.#syncValue(interval, state.interval);
    pause.textContent = state.paused ? "Resume" : "Pause";

    if (state.error) {
      status.textContent = "error";
      dot.className = "dot err";
    } else if (state.paused) {
      status.textContent = "paused";
      dot.className = "dot paused";
    } else {
      status.textContent = state.updatedAt ? `updated ${state.updatedAt.toLocaleTimeString()}` : "connecting…";
      dot.className = "dot";
    }
  }

  // Only touch the <select> when the value really changed, so an open dropdown isn't reset.
  static #syncValue(select, value) {
    if (value != null && select.value !== String(value)) select.value = String(value);
  }
}
