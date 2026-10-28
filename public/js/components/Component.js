/**
 * Base class for UI components. Subscribes to the store and re-renders on every change.
 * Subclasses implement render(state, patch); they read state and call `actions`
 * (the App) to change it, never the store directly.
 */
export class Component {
  constructor({ store, actions }) {
    this.store = store;
    this.actions = actions;
    store.on("change", (state, patch) => this.render(state, patch));
  }

  render(_state, _patch) {
    throw new Error(`${this.constructor.name}.render() not implemented`);
  }
}
