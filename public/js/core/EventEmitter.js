/** Minimal Observer: subscribers register with on() and are called by emit(). */
export class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event).delete(listener);
  }

  emit(event, ...args) {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }
}
