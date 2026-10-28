/**
 * Remembers UI choices (row limit, refresh interval, view, table) in this browser.
 * Storage can be unavailable (private mode, blocked cookies), so every access is guarded.
 */
export class Preferences {
  #key;

  constructor(key = "mysql-live-viewer") {
    this.#key = key;
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.#key)) ?? {};
    } catch {
      return {};
    }
  }

  save(values) {
    try {
      localStorage.setItem(this.#key, JSON.stringify({ ...this.load(), ...values }));
    } catch {
      // Not critical: preferences just won't persist.
    }
  }
}
