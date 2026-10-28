import { esc } from "../utils/format.js";

/** Small constraint badges shared by the data grid header and the structure view. */
export function columnBadges(column) {
  if (!column) return "";
  const badges = [];
  if (column.primaryKey) badges.push(badge("pk", "PK", "Primary key"));
  if (column.references) {
    const target = `${column.references.table}.${column.references.column}`;
    badges.push(badge("fk", "FK", `Foreign key → ${target}`));
  }
  if (column.unique) badges.push(badge("uq", "UQ", "Unique"));
  if (!column.nullable && !column.primaryKey) badges.push(badge("nn", "NN", "Not null"));
  if (column.autoIncrement) badges.push(badge("ai", "AI", "Auto increment"));
  return badges.join("");
}

function badge(kind, label, title) {
  return `<span class="badge badge-${kind}" title="${esc(title)}">${label}</span>`;
}
