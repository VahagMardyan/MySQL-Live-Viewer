import { EventEmitter } from "./EventEmitter.js";

/**
 * Single source of truth for UI state. Components never change state directly;
 * they call App actions, which call set(). Every set() emits "change".
 */
export class Store extends EventEmitter {
  #state;

  constructor(initialState) {
    super();
    this.#state = Object.freeze({ ...initialState });
  }

  get state() {
    return this.#state;
  }

  set(patch) {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    this.emit("change", this.#state, patch);
  }
}
