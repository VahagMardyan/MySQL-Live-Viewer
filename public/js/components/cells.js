import { esc } from "../utils/format.js";

/** Renders one table cell. Long values are cut off by CSS; hovering shows the full text. */
export function cell(value, className = "") {
  if (value === null || value === undefined) return '<td class="null">NULL</td>';
  let text;
  if (typeof value === "object") {
    // Binary columns arrive as serialized Buffers; JSON columns as objects.
    text = value.type === "Buffer" && Array.isArray(value.data)
      ? `<binary ${value.data.length} bytes>`
      : JSON.stringify(value);
  } else {
    text = String(value);
  }
  const safe = esc(text);
  const cls = className ? ` class="${className}"` : "";
  return `<td${cls} title="${safe}">${safe}</td>`;
}
