import { esc } from "../utils/format.js";
import { columnBadges } from "./badges.js";

/** Shows columns with types, defaults and constraints, then the table-level constraints. */
export class StructurePanel {
  #container;
  #last = "";

  constructor(container) {
    this.#container = container;
  }

  render(state, { force = false } = {}) {
    const { structure, currentTable } = state;
    if (!structure || structure.table !== currentTable) {
      this.#show('<div class="empty">Loading…</div>');
      this.#last = "";
      return;
    }

    const signature = JSON.stringify(structure);
    if (!force && signature === this.#last) return; // schema unchanged since last refresh
    this.#last = signature;

    this.#show(`
      ${StructurePanel.#columnsTable(structure)}
      <div class="cards">
        ${StructurePanel.#card("Primary key", structure.primaryKey.length
          ? `<code>${structure.primaryKey.map(esc).join(", ")}</code>`
          : "")}
        ${StructurePanel.#card("Foreign keys", StructurePanel.#foreignKeys(structure.foreignKeys))}
        ${StructurePanel.#card("Unique constraints", StructurePanel.#list(structure.uniqueConstraints,
          (u) => `<b>${esc(u.name)}</b> <code>(${u.columns.map(esc).join(", ")})</code>`))}
        ${StructurePanel.#card("Check constraints", StructurePanel.#list(structure.checkConstraints,
          (c) => `<b>${esc(c.name)}</b> <code>${esc(c.clause)}</code>`))}
      </div>`);
  }

  #show(html) {
    this.#container.innerHTML = html;
    this.#container.dataset.owner = "structure";
  }

  static #columnsTable({ columns }) {
    const hasComments = columns.some((c) => c.comment);
    const rows = columns
      .map((c) => `
        <tr>
          <td class="muted">${c.position}</td>
          <td><b>${esc(c.name)}</b></td>
          <td><code>${esc(c.type)}</code></td>
          <td>${c.nullable ? "Yes" : "No"}</td>
          <td>${StructurePanel.#defaultValue(c.default)}</td>
          <td class="badges">${columnBadges(c) || '<span class="muted">—</span>'}</td>
          <td>${StructurePanel.#reference(c.references)}</td>
          <td>${c.extra ? `<code>${esc(c.extra)}</code>` : '<span class="muted">—</span>'}</td>
          ${hasComments ? `<td>${esc(c.comment)}</td>` : ""}
        </tr>`)
      .join("");
    return `
      <table class="structure">
        <thead><tr>
          <th>#</th><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th>
          <th>Constraints</th><th>References</th><th>Extra</th>${hasComments ? "<th>Comment</th>" : ""}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  static #defaultValue({ kind, text }) {
    if (kind === "none") return '<span class="muted">—</span>';
    if (kind === "null") return '<span class="null">NULL</span>';
    const cls = kind === "expression" ? ' class="expr"' : "";
    return `<code${cls}>${esc(text)}</code>`;
  }

  static #reference(ref) {
    if (!ref) return '<span class="muted">—</span>';
    return `${StructurePanel.#tableLink(ref.table)}<code>.${esc(ref.column)}</code>`;
  }

  static #foreignKeys(foreignKeys) {
    return StructurePanel.#list(foreignKeys, (fk) => `
      <b>${esc(fk.name)}</b><br>
      <code>(${fk.columns.map(esc).join(", ")})</code> →
      ${StructurePanel.#tableLink(fk.referencedTable)}<code>(${fk.referencedColumns.map(esc).join(", ")})</code><br>
      <span class="muted">ON UPDATE ${esc(fk.onUpdate)} · ON DELETE ${esc(fk.onDelete)}</span>`);
  }

  // Clicking a referenced table name opens that table (handled by ContentArea).
  static #tableLink(table) {
    return `<button type="button" class="link" data-goto="${esc(table)}">${esc(table)}</button>`;
  }

  static #list(items, renderItem) {
    if (!items.length) return "";
    return `<ul>${items.map((item) => `<li>${renderItem(item)}</li>`).join("")}</ul>`;
  }

  static #card(title, body) {
    return `<section class="card"><h3>${title}</h3>${body || '<p class="muted">None</p>'}</section>`;
  }
}
