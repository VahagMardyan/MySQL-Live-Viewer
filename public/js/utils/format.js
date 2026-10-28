const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for safe use inside HTML. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

export function formatCount(n) {
  return Number(n).toLocaleString();
}

export function plural(n, word) {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}
