import { openModal, CancelledError } from "../ui/Modal.js";
import { esc } from "../utils/format.js";

/**
 * Guards every change. run(task) first makes sure editing is unlocked, asking for
 * a MySQL username and password if needed, then runs the task. If the server says
 * the session expired, it asks again once and retries.
 *
 * The write token lives only in ApiClient's memory: reloading the page locks editing.
 */
export class WriteAccess {
  #api;
  #store;
  #lastUser = null;
  #timer = null;
  #ttlMs = 5 * 60_000;

  constructor({ api, store }) {
    this.#api = api;
    this.#store = store;
  }

  get unlocked() {
    return this.#api.hasWriteToken;
  }

  async run(task) {
    if (!this.unlocked) await this.unlock();
    try {
      return this.#extend(await task());
    } catch (err) {
      if (err.code !== "locked") throw err;
      this.#setLocked();
      await this.unlock("Editing was locked because of inactivity. Enter your password again.");
      return this.#extend(await task());
    }
  }

  /** Shows the password dialog. Throws CancelledError if the user closes it. */
  async unlock(reason = "") {
    const { meta } = this.#store.state;
    const user = this.#lastUser ?? meta?.readUser ?? "";
    const minutes = meta?.writeSessionMinutes ?? 5;
    const result = await openModal({
      title: "Unlock editing",
      submitLabel: "Unlock",
      body: `
        ${reason ? `<p class="modal-note">${esc(reason)}</p>` : ""}
        <p>Changes run as this MySQL user, with its permissions. The password is checked by
          MySQL and is not stored. Editing locks again after ${minutes} minutes without changes.</p>
        <label class="stack">MySQL user
          <input name="user" value="${esc(user)}" autocomplete="username" spellcheck="false" ${user ? "" : "autofocus"}></label>
        <label class="stack">Password
          <input name="password" type="password" autocomplete="current-password" ${user ? "autofocus" : ""}></label>`,
      onSubmit: async (form) => {
        const session = await this.#api.unlock(form.elements.user.value, form.elements.password.value);
        form.elements.password.value = "";
        return session;
      },
    });
    if (!result) throw new CancelledError();
    this.#lastUser = result.user;
    this.#ttlMs = result.ttlMs;
    this.#extend();
    return result;
  }

  async lock() {
    await this.#api.lock().catch(() => {});
    this.#setLocked();
  }

  // Mirrors the server's idle timeout, so the toolbar shows "locked" at the same time.
  #extend(result) {
    const expiresAt = Date.now() + this.#ttlMs;
    this.#store.set({ write: { user: this.#lastUser, expiresAt } });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#setLocked(), this.#ttlMs);
    return result;
  }

  #setLocked() {
    clearTimeout(this.#timer);
    this.#api.clearWriteToken();
    if (this.#store.state.write) this.#store.set({ write: null });
  }
}
