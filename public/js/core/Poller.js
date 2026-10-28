/** Calls a task on an interval, never running two calls at the same time. */
export class Poller {
  #task;
  #intervalMs;
  #timer = null;
  #running = false;

  constructor(task, intervalMs) {
    this.#task = task;
    this.#intervalMs = intervalMs;
  }

  get isActive() {
    return this.#timer !== null;
  }

  start() {
    this.stop();
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  setInterval(ms) {
    this.#intervalMs = ms;
    if (this.isActive) this.start();
  }

  async #tick() {
    if (this.#running) return; // previous refresh still in flight
    this.#running = true;
    try {
      await this.#task();
    } finally {
      this.#running = false;
    }
  }
}
