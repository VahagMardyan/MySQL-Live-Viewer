import { Component } from "./Component.js";
import { formatCount } from "../utils/format.js";

/** Header controls: database name, status dot, page size, refresh interval, pause, edit lock. */
export class Toolbar extends Component {
  #el;

  constructor(deps, elements) {
    super(deps);
    this.#el = elements;
    this.#el.pageSize.addEventListener("change", (e) => this.actions.setPageSize(Number(e.target.value)));
    this.#el.interval.addEventListener("change", (e) => this.actions.setRefreshInterval(Number(e.target.value)));
    this.#el.pause.addEventListener("click", () => this.actions.togglePause());
    this.#el.lock.addEventListener("click", () => this.actions.toggleLock());
  }

  render(state, patch) {
    const { db, status, dot, pageSize, interval, pause, lock } = this.#el;

    if ("meta" in patch && state.meta) {
      db.textContent = `· ${state.meta.database}`;
      db.title = state.meta.server;
      pageSize.innerHTML = state.meta.pageSizes
        .map((n) => `<option value="${n}">${formatCount(n)}</option>`)
        .join("");
    }

    Toolbar.#syncValue(pageSize, state.pageSize);
    Toolbar.#syncValue(interval, state.interval);
    pause.textContent = state.paused ? "Resume" : "Pause";

    if ("write" in patch || !lock.textContent) {
      const unlocked = Boolean(state.write);
      lock.classList.toggle("unlocked", unlocked);
      lock.textContent = unlocked ? `🔓 ${state.write.user}` : "🔒 Locked";
      lock.title = unlocked
        ? `Editing is unlocked as MySQL user ${state.write.user}. Click to lock.`
        : "Editing is locked. Click to unlock with a MySQL password.";
    }

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
